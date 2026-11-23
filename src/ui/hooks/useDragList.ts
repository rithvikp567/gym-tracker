import {
  useEffect,
  useLayoutEffect,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { play } from "../motion";
import { clampDrag, dropIndex, edgeScroll, moveIndex, pressIntent, shiftFor, stepOf, swipeOffset, swipeOpens, type Slot } from "./dragMath";

/** How long a press is held, without moving, before the item lifts and follows the pointer. */
export const HOLD_MS = 350;
/** How far a press may wander before it counts as moving (a scroll, a swipe): finger, mouse. */
const SLOP = { touch: 8, mouse: 5 };
/** The settle into place after a drop, and the swap after a keyboard move. */
const SETTLE_MS = 200;

export interface DragListOptions {
  /** The items, in the order they're stored. */
  ids: readonly string[];
  /**
   * An item was dropped at `index`: its new place in the list. Saves run one after another (a
   * second move waits for the first), so each one starts from the order the last one saved.
   */
  onMove: (id: string, index: number) => unknown;
  /** Width (px) of the action a swipe right uncovers on an item's left. Leave out for no swipe. */
  revealWidth?: number;
  /** Plain ↑ / ↓ on a grip move the item too (a handle that does nothing else); otherwise Alt + ↑ / ↓. */
  arrowKeys?: boolean;
}

/** Spread on the element you press to move an item: a day's head, an exercise's handle. */
export interface GripProps {
  ref: (el: HTMLElement | null) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
}

/** Spread on the action a swipe uncovers (Delete): focus lands on it from the keyboard. */
export interface ActionProps {
  ref: (el: HTMLElement | null) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onBlur: (e: ReactFocusEvent<HTMLElement>) => void;
}

export interface DragList {
  /** The ids in the order to draw them: a drop shows its new order at once, before the save lands. */
  order: readonly string[];
  /** The item being dragged or swiped right now, and which. */
  active: { id: string; kind: "drag" | "swipe" } | null;
  /** The item swiped open (its action showing), if any. Only one at a time. */
  revealed: string | null;
  /** Something is dragged, swiped or open: the page should hold still. */
  busy: boolean;
  /** The list's element: guards against scrolling and stray clicks while you drag. */
  list: (el: HTMLElement | null) => void;
  /** Each item's element: what lifts and moves while dragged. */
  item: (id: string) => (el: HTMLElement | null) => void;
  /** What slides aside when an item is swiped (on top of its action). */
  slider: (id: string) => (el: HTMLElement | null) => void;
  grip: (id: string) => GripProps;
  action: (id: string) => ActionProps;
  /** Swipes the open item shut. */
  close: () => void;
}

/**
 * Reorders a list by press-and-hold and drag, and (with `revealWidth`) swipes an item right to
 * uncover an action on its left, for touch and mouse alike:
 *
 * - Hold a grip still for HOLD_MS and the item lifts; drag it up or down and the others slide
 *   aside to show where it will land; let go to drop it there (`onMove`). A mouse can also just
 *   drag. Moving a finger before the hold is up scrolls the page as usual; once an item is lifted
 *   the page doesn't scroll (a non-passive touchmove on the list cancels it), but it scrolls
 *   itself when you hold the item near the top or bottom edge. A cancelled pointer (the browser
 *   took the touch) or Escape puts it back.
 * - Swipe a grip right (or drag with a mouse) to uncover the action; swipe it back, press
 *   anywhere else, or swipe another item to close it.
 * - No click follows a drag, a swipe, a hold, or a press that closed an open item, so a card
 *   head that is also a grip doesn't toggle.
 * - Keyboard: Alt + ↑ / ↓ on a grip moves the item (plain arrows with `arrowKeys`); Delete or
 *   Backspace uncovers the action and focuses it; Escape closes it again.
 *
 * Moves during a gesture are written to the elements directly (no re-render per pointer move);
 * React state changes only when a gesture starts, ends, or opens an item.
 */
export function useDragList(options: DragListOptions): DragList {
  const key = options.ids.join("\n");
  // The order shown after a move until its save comes back (only while it holds the same items).
  const [pending, setPending] = useState<readonly string[] | null>(null);
  const order = pending && sameItems(pending, options.ids) ? pending : options.ids;
  const [active, setActive] = useState<DragList["active"]>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [ctl] = useState(() => new DragController({ setPending, setActive, setRevealed }));
  ctl.options = options;
  ctl.order = order;

  // The list changed (the saved order came back, or a sync) and no move is still on its way:
  // the stored order is the one to show. With moves still saving, the first save's order coming
  // back would flash it before the second lands.
  useEffect(() => {
    if (ctl.inFlight === 0) setPending(null);
  }, [key, ctl]);

  // After each commit: settle moved items into their new places, put focus back after a
  // keyboard move, and let go of a drag whose list changed under it (a sync).
  useLayoutEffect(() => ctl.afterCommit());

  // An open item closes on a press anywhere but on it or its action.
  useEffect(() => {
    if (revealed === null || typeof document === "undefined") return;
    const onDown = (e: Event) => ctl.pressOutside(e.target);
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [revealed, ctl]);

  useEffect(() => () => ctl.dispose(), [ctl]);

  return {
    order,
    active,
    revealed,
    busy: active !== null || revealed !== null,
    list: ctl.listRef,
    item: ctl.items.refFor,
    slider: ctl.sliders.refFor,
    grip: ctl.gripProps,
    action: ctl.actionProps,
    close: ctl.close,
  };
}

function sameItems(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

/** Elements by id, with one stable ref callback per id (a new one each render would re-attach). */
class ElementMap {
  readonly els = new Map<string, HTMLElement>();
  private readonly setters = new Map<string, (el: HTMLElement | null) => void>();

  refFor = (id: string): ((el: HTMLElement | null) => void) => {
    let set = this.setters.get(id);
    if (!set) {
      set = (el) => {
        if (el) this.els.set(id, el);
        else if (this.els.get(id)) this.els.delete(id);
      };
      this.setters.set(id, set);
    }
    return set;
  };

  get(id: string): HTMLElement | undefined {
    return this.els.get(id);
  }
}

interface Gesture {
  id: string;
  pointerId: number;
  mouse: boolean;
  x0: number;
  y0: number;
  scroll0: number;
  /** The latest pointer position (viewport). */
  x: number;
  y: number;
  phase: "press" | "drag" | "swipe";
  timer: ReturnType<typeof setTimeout> | undefined;
  grip: HTMLElement;
  /** Drag: the list as it was when the item lifted, its items' places, and where it would land. */
  ids: readonly string[];
  slots: Slot[];
  from: number;
  to: number;
  step: number;
  /** Swipe: where it started (0 closed, the width open) and where it is. */
  base: number;
  offset: number;
}

interface Setters {
  setPending: (order: readonly string[] | null) => void;
  setActive: (a: DragList["active"]) => void;
  setRevealed: (id: string | null) => void;
}

const scrollTop = () => (typeof window === "undefined" ? 0 : window.scrollY || 0);

/** The bottom of the visible page: the top of the phone's floating tab bar, or the window's bottom. */
function visibleBottom(): number {
  const height = typeof window === "undefined" ? 0 : window.innerHeight || 0;
  const bar = typeof document === "undefined" ? null : document.querySelector?.(".tabbar");
  const top = bar?.getBoundingClientRect().top;
  return top !== undefined && top > height / 2 ? top : height;
}

class DragController {
  options: DragListOptions = { ids: [], onMove: () => {} };
  order: readonly string[] = [];
  /** Moves handed to `onMove` that haven't finished saving. */
  inFlight = 0;
  private saving: Promise<unknown> = Promise.resolve();
  readonly items = new ElementMap();
  readonly sliders = new ElementMap();
  private readonly grips = new ElementMap();
  private readonly actions = new ElementMap();
  private g: Gesture | null = null;
  private revealed: string | null = null;
  /** Swallow the next click in the list (it ends a drag, a swipe, a hold…). */
  private suppressClick = false;
  /** Positions on screen (viewport top) of the items before a reorder, to glide them from. */
  private flipFrom: Map<string, number> | null = null;
  private refocus: string | null = null;
  private focusAction: string | null = null;
  private frame = 0;
  private gripPropsCache = new Map<string, GripProps>();
  private actionPropsCache = new Map<string, ActionProps>();

  constructor(private readonly set: Setters) {}

  // ───── Refs and props ─────

  /** The list's element: a non-passive touchmove (registered before any touch starts, as iOS needs) and the click guard. */
  listRef = (el: HTMLElement | null): (() => void) | undefined => {
    if (!el) return undefined;
    const onTouchMove = (e: Event) => {
      if (this.g && this.g.phase !== "press" && e.cancelable !== false) e.preventDefault();
    };
    const onDown = () => {
      this.suppressClick = false;
    };
    const onClick = (e: Event) => {
      // Only a click made by a press (detail ≥ 1): Enter or Space on a button is never swallowed,
      // even when the drag's own click never came (let go outside the list).
      if (!this.suppressClick || !(e as MouseEvent).detail) return;
      this.suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("click", onClick, true);
    };
  };

  gripProps = (id: string): GripProps => {
    let props = this.gripPropsCache.get(id);
    if (!props) {
      props = {
        ref: this.grips.refFor(id),
        onPointerDown: (e) => this.down(id, e),
        onKeyDown: (e) => this.keyDown(id, e),
        onContextMenu: (e) => {
          if (this.g?.id === id) e.preventDefault(); // a long press is a hold here, not a menu
        },
      };
      this.gripPropsCache.set(id, props);
    }
    return props;
  };

  actionProps = (id: string): ActionProps => {
    let props = this.actionPropsCache.get(id);
    if (!props) {
      props = {
        ref: this.actions.refFor(id),
        onKeyDown: (e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          this.reveal(null);
          this.grips.get(id)?.focus?.();
        },
        // Tabbing on to something else closes it (a press elsewhere is handled by pressOutside).
        onBlur: (e) => {
          if (e.relatedTarget && this.revealed === id) this.reveal(null);
        },
      };
      this.actionPropsCache.set(id, props);
    }
    return props;
  };

  close = (): void => this.reveal(null);

  // ───── Pointer ─────

  private down(id: string, e: ReactPointerEvent<HTMLElement>): void {
    const mouse = e.pointerType === "mouse";
    if (mouse && e.button !== 0) return;
    if (this.g) {
      // A second finger: let go of everything.
      this.cancel();
      return;
    }
    // A press on another item closes the open one and does nothing else.
    if (this.revealed !== null && this.revealed !== id) {
      this.reveal(null);
      this.suppressClick = true;
    }
    const scroll0 = scrollTop();
    this.g = {
      id,
      pointerId: e.pointerId,
      mouse,
      x0: e.clientX,
      y0: e.clientY,
      scroll0,
      x: e.clientX,
      y: e.clientY,
      phase: "press",
      timer: setTimeout(() => this.startDrag(), HOLD_MS),
      grip: e.currentTarget,
      ids: [],
      slots: [],
      from: -1,
      to: -1,
      step: 0,
      base: 0,
      offset: 0,
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", this.onMove, { passive: true });
      window.addEventListener("pointerup", this.onUp);
      window.addEventListener("pointercancel", this.onCancel);
      window.addEventListener("keydown", this.onKey, true);
      window.addEventListener("blur", this.onCancel);
    }
  }

  private onMove = (e: PointerEvent): void => {
    const g = this.g;
    if (!g || e.pointerId !== g.pointerId) return;
    g.x = e.clientX;
    g.y = e.clientY;
    const dx = g.x - g.x0;
    if (g.phase === "drag") this.moveDrag();
    else if (g.phase === "swipe") this.moveSwipe(dx);
    else {
      const intent = pressIntent(dx, g.y - g.y0, {
        slop: g.mouse ? SLOP.mouse : SLOP.touch,
        mouse: g.mouse,
        canSwipe: Boolean(this.options.revealWidth),
        open: this.revealed === g.id,
      });
      if (intent === "swipe") this.startSwipe();
      else if (intent === "drag") this.startDrag();
      else if (intent === "none") {
        // A finger scrolling the page: no drag, and an open item closes as it scrolls away.
        this.reveal(null);
        this.end();
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    const g = this.g;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.phase === "drag") this.drop();
    else if (g.phase === "swipe") this.endSwipe(false);
    else {
      // A tap. On the open item it just closes it.
      if (this.revealed === g.id) {
        this.reveal(null);
        this.suppressClick = true;
      }
      this.end();
    }
  };

  /** pointercancel (the browser took the touch) or the window losing focus. */
  private onCancel = (e: Event): void => {
    const g = this.g;
    const pointerId = (e as Partial<PointerEvent>).pointerId;
    if (!g || (pointerId !== undefined && pointerId !== g.pointerId)) return;
    this.cancel();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !this.g || this.g.phase === "press") return;
    e.preventDefault();
    e.stopPropagation();
    this.cancel();
  };

  /** Lets go of the current gesture, putting things back where they were. */
  private cancel(): void {
    const g = this.g;
    if (!g) return;
    if (g.phase === "drag") {
      this.flipFrom = this.positions();
      this.end();
      this.set.setActive(null);
      this.settle();
    } else if (g.phase === "swipe") this.endSwipe(true);
    else this.end();
  }

  /** Forgets the gesture and its listeners (and the scroll loop). */
  private end(): void {
    const g = this.g;
    if (!g) return;
    clearTimeout(g.timer);
    this.g = null;
    if (this.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (typeof window !== "undefined") {
      window.removeEventListener("pointermove", this.onMove);
      window.removeEventListener("pointerup", this.onUp);
      window.removeEventListener("pointercancel", this.onCancel);
      window.removeEventListener("keydown", this.onKey, true);
      window.removeEventListener("blur", this.onCancel);
    }
  }

  dispose(): void {
    if (this.g?.phase === "drag") this.clearTransforms();
    this.end();
  }

  // ───── Drag ─────

  private startDrag(): void {
    const g = this.g;
    if (!g || g.phase !== "press") return;
    clearTimeout(g.timer);
    const ids = this.order;
    const from = ids.indexOf(g.id);
    const els = ids.map((id) => this.items.get(id));
    if (from < 0 || els.some((el) => !el)) {
      this.end();
      return;
    }
    const scroll = scrollTop();
    g.slots = els.map((el) => {
      // A settle still playing would put the box off its place.
      el!.getAnimations?.().forEach((a) => a.finish());
      const r = el!.getBoundingClientRect();
      return { top: r.top + scroll, height: r.height };
    });
    g.ids = ids;
    g.from = g.to = from;
    g.step = stepOf(g.slots, from);
    g.phase = "drag";
    this.reveal(null);
    this.suppressClick = true;
    try {
      g.grip.setPointerCapture?.(g.pointerId);
    } catch {
      // The pointer is already gone; pointerup / pointercancel end the drag.
    }
    if (typeof window !== "undefined") window.getSelection?.()?.removeAllRanges(); // a hold may have started one
    // The others glide aside as the dragged one passes them.
    ids.forEach((id, i) => {
      if (i !== from) this.items.get(id)!.style.transition = "transform var(--dur) var(--ease-out)";
    });
    this.set.setActive({ id: g.id, kind: "drag" });
    this.moveDrag();
  }

  private moveDrag(): void {
    const g = this.g;
    if (!g || g.phase !== "drag") return;
    const dy = clampDrag(g.slots, g.from, g.y + scrollTop() - (g.y0 + g.scroll0));
    const el = this.items.get(g.id);
    if (el) el.style.transform = `translateY(${dy}px)`;
    const to = dropIndex(g.slots, g.from, dy);
    if (to !== g.to) {
      g.to = to;
      g.ids.forEach((id, i) => {
        if (i === g.from) return;
        const other = this.items.get(id);
        const shift = shiftFor(i, g.from, to, g.step);
        if (other) other.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    }
    this.scrollNearEdge();
  }

  /** Held near the top or bottom of the screen, the page scrolls (and the item with it). */
  private scrollNearEdge(): void {
    const g = this.g;
    if (!g || g.phase !== "drag" || this.frame || typeof requestAnimationFrame !== "function") return;
    if (!edgeScroll(g.y, 0, visibleBottom())) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const now = this.g;
      if (!now || now.phase !== "drag") return;
      const speed = edgeScroll(now.y, 0, visibleBottom());
      const before = scrollTop();
      if (speed) window.scrollBy(0, speed);
      if (scrollTop() !== before) this.moveDrag(); // schedules the next frame
    });
  }

  private drop(): void {
    const g = this.g;
    if (!g) return;
    const { id, from, to, ids } = g;
    this.flipFrom = this.positions();
    this.end();
    this.suppressClick = true;
    this.set.setActive(null);
    if (to === from) {
      this.settle();
      return;
    }
    // The new order and the cleared offsets land in the same frame (afterCommit): no flash of the old order.
    this.move(id, moveIndex(ids, from, to), to);
  }

  /** Shows `order` at once and saves the move, after any move still saving. */
  private move(id: string, order: readonly string[], to: number): void {
    this.set.setPending(order);
    this.inFlight += 1;
    const onMove = this.options.onMove;
    this.saving = this.saving
      .then(() => onMove(id, to))
      .then(
        () => {
          this.inFlight -= 1;
        },
        (error: unknown) => {
          this.inFlight -= 1;
          console.error(error);
          this.set.setPending(null); // show what's stored
        },
      );
  }

  /** Where each item is on screen now, offsets included. */
  private positions(): Map<string, number> {
    const at = new Map<string, number>();
    for (const [id, el] of this.items.els) at.set(id, el.getBoundingClientRect().top);
    return at;
  }

  private clearTransforms(): void {
    for (const el of this.items.els.values()) {
      el.style.transition = "";
      el.style.transform = "";
    }
  }

  /** Clears the drag offsets and glides every item that moved from where it was shown (flipFrom) to its place. */
  private settle(): void {
    const from = this.flipFrom;
    this.flipFrom = null;
    this.clearTransforms();
    if (!from) return;
    for (const [id, el] of this.items.els) {
      const was = from.get(id);
      if (was === undefined) continue;
      const by = was - el.getBoundingClientRect().top;
      if (Math.abs(by) >= 1) play(el, [{ transform: `translateY(${by}px)` }, { transform: "none" }], SETTLE_MS);
    }
  }

  // ───── Swipe ─────

  private startSwipe(): void {
    const g = this.g;
    const width = this.options.revealWidth ?? 0;
    const el = g && this.sliders.get(g.id);
    if (!g || !el || !width) {
      this.end();
      return;
    }
    clearTimeout(g.timer);
    g.phase = "swipe";
    g.base = this.revealed === g.id ? width : 0;
    g.offset = g.base;
    if (this.revealed !== null && this.revealed !== g.id) this.reveal(null);
    this.suppressClick = true;
    try {
      g.grip.setPointerCapture?.(g.pointerId);
    } catch {
      // Gone already; pointerup / pointercancel end it.
    }
    el.style.transition = "none";
    this.set.setActive({ id: g.id, kind: "swipe" });
    this.moveSwipe(g.x - g.x0);
  }

  private moveSwipe(dx: number): void {
    const g = this.g;
    const el = g && this.sliders.get(g.id);
    if (!g || !el) return;
    g.offset = swipeOffset(g.base, dx, this.options.revealWidth ?? 0);
    el.style.transform = `translateX(${g.offset}px)`;
  }

  /** Let go: open past half way, else shut (a cancelled swipe goes back to how it started). */
  private endSwipe(cancelled: boolean): void {
    const g = this.g;
    if (!g) return;
    const open = cancelled ? g.base > 0 : swipeOpens(g.offset, this.options.revealWidth ?? 0);
    const el = this.sliders.get(g.id);
    // From the finger's offset, the item's own transition carries it the rest of the way to
    // the open or shut place its class gives it.
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
    }
    this.end();
    this.set.setActive(null);
    this.reveal(open ? g.id : null);
  }

  private reveal(id: string | null): void {
    if (this.revealed === id) return;
    this.revealed = id;
    this.set.setRevealed(id);
  }

  /** A press somewhere on the page while an item is open: anywhere but its action or a grip (they decide themselves) closes it. */
  pressOutside(target: EventTarget | null): void {
    if (this.revealed === null) return;
    const node = target as Node | null;
    const inside = (el: HTMLElement | undefined) => Boolean(node && el?.contains?.(node));
    if (inside(this.actions.get(this.revealed))) return;
    for (const el of this.grips.els.values()) if (inside(el)) return;
    this.reveal(null);
  }

  // ───── Keyboard ─────

  private keyDown(id: string, e: ReactKeyboardEvent<HTMLElement>): void {
    const arrow = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (arrow && (e.altKey || this.options.arrowKeys) && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      if (this.g) return;
      const from = this.order.indexOf(id);
      const to = from + arrow;
      if (from < 0 || to < 0 || to >= this.order.length) return;
      this.flipFrom = this.positions();
      this.refocus = id; // a moved element can lose focus as React re-inserts it
      this.move(id, moveIndex(this.order, from, to), to);
    } else if ((e.key === "Delete" || e.key === "Backspace") && this.options.revealWidth) {
      e.preventDefault();
      this.reveal(id);
      this.focusAction = id;
    } else if (e.key === "Escape" && this.revealed === id) {
      e.preventDefault();
      this.reveal(null);
    }
  }

  // ───── After React commits ─────

  afterCommit(): void {
    const g = this.g;
    // The list changed under a drag (a sync, a delete), or the swiped item went: let go.
    if (g?.phase === "drag" && g.ids.join("\n") !== this.order.join("\n")) {
      this.end();
      this.clearTransforms();
      this.set.setActive(null);
    } else if (g?.phase === "swipe" && !this.order.includes(g.id)) {
      this.end();
      this.set.setActive(null);
    }
    if (this.revealed !== null && !this.order.includes(this.revealed)) this.reveal(null);
    if (this.flipFrom && !this.g) this.settle();
    if (this.refocus) {
      const el = this.grips.get(this.refocus);
      this.refocus = null;
      if (el && typeof document !== "undefined" && document.activeElement !== el) el.focus?.({ preventScroll: true });
    }
    if (this.focusAction && this.revealed === this.focusAction) {
      const el = this.actions.get(this.focusAction);
      this.focusAction = null;
      el?.focus?.({ preventScroll: true });
    }
  }
}
