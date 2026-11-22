import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { play } from "../motion";
import { holdWindow, type PageName } from "../pageLayout";
import { onSlide } from "../slide";

/** How long the page stays put after a day step before it re-centers: long enough for a second tap. */
const STEP_HOLD_MS = 1200;
/** The glide to the new center once a hold lets go. */
const GLIDE_MS = 280;

/**
 * Centers its content vertically in the space it has (a `min-height` set in CSS); taller content
 * starts at the top and scrolls, never cut off.
 *
 * `hold` freezes the content where it is, e.g. while an exercise row is open: otherwise the
 * growing content would re-center and the row you just tapped would jump up. Released, it glides
 * to the new center; with the same height as before, nothing moves.
 */
export function CenterBlock({
  hold = false,
  className = "",
  contentClassName = "",
  page,
  children,
}: {
  hold?: boolean;
  className?: string;
  contentClassName?: string;
  /** Marks the content with its page (`data-page`), which sets its width. */
  page?: PageName;
  children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  /** How far below the block's top the centered content starts; kept as it was while held. */
  const offset = useRef(0);
  const wasHeld = useRef(false);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    if (hold) {
      wasHeld.current = true;
      return;
    }
    const heldAt = offset.current;
    // Layout position (offsetTop ignores the page-switch and glide transforms); the block is
    // `position: relative`, so it's measured from the block's top.
    const measure = () => {
      offset.current = i.offsetTop || 0;
    };
    measure();
    if (wasHeld.current) {
      wasHeld.current = false;
      glide(i, heldAt - offset.current);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(o);
    observer.observe(i);
    return () => observer.disconnect();
  }, [hold]);

  return (
    <div ref={outer} className={`center-block${hold ? " is-held" : ""} ${className}`.trim()} style={hold ? { paddingTop: offset.current } : undefined}>
      <div ref={inner} className={`center-block-content ${contentClassName}`.trim()} data-page={page}>
        {children}
      </div>
    </div>
  );
}

/** Moves `el` from `distance` px away back to where it now is (it already jumped there). */
function glide(el: HTMLElement, distance: number): void {
  if (Math.abs(distance) < 1) return;
  play(el, [{ transform: `translateY(${distance}px)` }, { transform: "none" }], GLIDE_MS);
}

interface Holds {
  /** Holds while `on` (one token per reason). */
  set: (token: object, on: boolean) => void;
  /** Holds for a moment, like a day step. */
  nudge: () => void;
}

const HoldContext = createContext<Holds | null>(null);

/**
 * A page's whole content, header included, centered on the screen: in the main panel on a
 * computer, between the top of the screen and the tab bar on a phone. The Shell renders one per
 * page, keyed by it, so a new page starts centered and fades in (`enter`).
 *
 * It holds still while a screen asks it to (`usePageHold`) and for a moment after each day step,
 * so the ‹ › arrows stay under your finger for the next tap even when the next day's content is
 * shorter or taller.
 */
export function CenterPage({ page, enter, children }: { page: PageName; enter: boolean; children: ReactNode }) {
  const [holds, setHolds] = useState<ReadonlySet<object>>(() => new Set());
  const [stepping, nudge] = useStepHold();
  const set = useCallback((token: object, on: boolean) => {
    setHolds((prev) => {
      if (prev.has(token) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(token);
      else next.delete(token);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ set, nudge }), [set, nudge]);
  return (
    <HoldContext.Provider value={value}>
      <CenterBlock hold={holds.size > 0 || stepping} className="page" contentClassName={`page-content${enter ? " page-in" : ""}`} page={page}>
        {children}
      </CenterBlock>
    </HoldContext.Provider>
  );
}

/** True from a day step (`slideNext`) or a nudge until a moment after the last one. */
function useStepHold(): [held: boolean, nudge: () => void] {
  const [held, setHeld] = useState(false);
  const [steps] = useState(() => holdWindow(STEP_HOLD_MS, setHeld));
  useEffect(() => {
    const off = onSlide(steps.poke);
    return () => {
      off();
      steps.dispose();
    };
  }, [steps]);
  return [held, steps.poke];
}

/**
 * While `on`, the page stays where it is instead of re-centering (an exercise row or a note is
 * open). A layout effect, so the hold is in place before the grown content is ever painted.
 */
export function usePageHold(on: boolean): void {
  const holds = useContext(HoldContext);
  useLayoutEffect(() => {
    if (!on || !holds) return;
    const token = {};
    holds.set(token, true);
    return () => holds.set(token, false);
  }, [on, holds]);
}

/**
 * For a control whose effect changes the page's height (a range with no data, another year):
 * call the returned function on use, and the page holds its place for a moment, like after a
 * day step, so the control stays under your finger for the next tap.
 */
export function useHoldBriefly(): () => void {
  return useContext(HoldContext)?.nudge ?? noop;
}

const noop = () => {};
