/**
 * The arithmetic behind dragging list items into a new order and swiping one open (useDragList).
 * Pure: page positions in, places and offsets out, so it's tested without a browser.
 */

/** An item's place on the page when a drag starts: its top (page coordinates) and height. */
export interface Slot {
  top: number;
  height: number;
}

const middle = (s: Slot) => s.top + s.height / 2;

/**
 * Keeps a dragged item within the list: its top no higher than the first item's top, its bottom
 * no lower than the last item's bottom. `dy` is how far it has been dragged.
 */
export function clampDrag(slots: readonly Slot[], from: number, dy: number): number {
  const self = slots[from];
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (!self || !first || !last) return 0;
  const min = first.top - self.top;
  const max = last.top + last.height - (self.top + self.height);
  return Math.max(min, Math.min(max, dy));
}

/**
 * The place a dragged item would land on if let go now. Moving down, it passes every item whose
 * middle its bottom edge has crossed; moving up, every item whose middle its top edge has
 * crossed. Works when items differ in height (an open card among closed ones).
 */
export function dropIndex(slots: readonly Slot[], from: number, dy: number): number {
  const self = slots[from];
  if (!self) return from;
  let to = from;
  if (dy > 0) {
    const bottom = self.top + self.height + dy;
    for (let i = from + 1; i < slots.length && bottom > middle(slots[i]!); i++) to = i;
  } else if (dy < 0) {
    const top = self.top + dy;
    for (let i = from - 1; i >= 0 && top < middle(slots[i]!); i--) to = i;
  }
  return to;
}

/** The room the dragged item takes up in the list: its height plus the gap to its neighbour. */
export function stepOf(slots: readonly Slot[], from: number): number {
  const self = slots[from];
  if (!self) return 0;
  const next = slots[from + 1];
  const prev = slots[from - 1];
  const gap = next ? next.top - (self.top + self.height) : prev ? self.top - (prev.top + prev.height) : 0;
  return self.height + Math.max(0, gap);
}

/**
 * How far item `i` steps aside while the item from place `from` is held over place `to`: the
 * items it passed move into the room it left, one `step` up (dragging down) or down (dragging up).
 */
export function shiftFor(i: number, from: number, to: number, step: number): number {
  if (from < to && i > from && i <= to) return -step;
  if (to < from && i >= to && i < from) return step;
  return 0;
}

/** `list` with the item at `from` moved to `to` (a new array). */
export function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved!);
  return next;
}

/** What a press turns into once it moves before the hold is up. */
export type PressIntent = "swipe" | "drag" | "none";

/**
 * What a press that has moved (dx, dy) before the hold turns into. Null while it's still within
 * `slop` (a tap, or a hold so far). Mostly sideways: a swipe, where the list has one, rightward
 * to open, or leftward on the item that's already open. A mouse dragging otherwise starts the
 * drag at once (a mouse doesn't scroll the page by dragging). Anything else is a finger
 * scrolling the page: "none", and the press is over.
 */
export function pressIntent(
  dx: number,
  dy: number,
  { slop, mouse, canSwipe, open }: { slop: number; mouse: boolean; canSwipe: boolean; open: boolean },
): PressIntent | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return null;
  if (canSwipe && ax > ay && (dx > 0 || open)) return "swipe";
  if (mouse && (!canSwipe || ay >= ax)) return "drag";
  return "none";
}

/**
 * Where a swiped item sits: from `base` (0 closed, `width` open) moved `dx` by the finger, never
 * left of closed; past fully open it stretches at a third of the finger's pace.
 */
export function swipeOffset(base: number, dx: number, width: number): number {
  const x = base + dx;
  if (x <= 0) return 0;
  return x > width ? width + (x - width) / 3 : x;
}

/** A swipe let go at `offset` stays open once it's more than half way. */
export function swipeOpens(offset: number, width: number): boolean {
  return offset > width / 2;
}

/**
 * How far to scroll the page this frame while a dragged item is held near the top or bottom of
 * the visible area (`top`…`bottom`, viewport coordinates): up to `max` px, faster closer to the
 * edge; negative scrolls up. Zero away from the edges.
 */
export function edgeScroll(y: number, top: number, bottom: number, zone = 56, max = 14): number {
  if (y < top + zone) return -Math.ceil(max * Math.min(1, (top + zone - y) / zone));
  if (y > bottom - zone) return Math.ceil(max * Math.min(1, (y - (bottom - zone)) / zone));
  return 0;
}
