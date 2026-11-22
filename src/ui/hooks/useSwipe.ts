import { useEffect, useRef, type RefObject } from "react";

const MIN_DISTANCE = 60;

export interface SwipeHandlers {
  /** Finger moves left → right. */
  onSwipeRight?: (() => void) | undefined;
  onSwipeLeft?: (() => void) | undefined;
}

/**
 * Horizontal swipe on the element in `ref`. Ignores mostly-vertical drags (scrolling) and drags
 * that start in a text field. Handlers may change every render, and so may the element: it
 * binds whenever one shows up (e.g. after a first render that drew something else).
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, handlers: SwipeHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  const bound = useRef<{ el: HTMLElement; unbind: () => void } | null>(null);

  // After every commit: bind to the element if it's new, appeared, or went away.
  useEffect(() => {
    const el = ref.current;
    if (bound.current?.el === el) return;
    bound.current?.unbind();
    bound.current = el ? { el, unbind: bindSwipe(el, latest) } : null;
  });

  useEffect(
    () => () => {
      bound.current?.unbind();
      bound.current = null;
    },
    [],
  );
}

function bindSwipe(el: HTMLElement, handlers: RefObject<SwipeHandlers>): () => void {
  let start: { x: number; y: number } | null = null;

  const onStart = (e: TouchEvent) => {
    const target = e.target as HTMLElement;
    const t = e.touches[0];
    start = t && e.touches.length === 1 && !target.closest("input, textarea, select") ? { x: t.clientX, y: t.clientY } : null;
  };
  const onEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    start = null;
    if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0) handlers.current.onSwipeRight?.();
    else handlers.current.onSwipeLeft?.();
  };

  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchend", onEnd, { passive: true });
  return () => {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchend", onEnd);
  };
}

/** Calls `fn` once input settles; flushes a pending call on unmount so nothing is lost. */
export function useDebounced<T>(fn: (value: T) => void, ms: number): (value: T) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current) fnRef.current(pending.current.value);
    },
    [],
  );

  const call = useRef((value: T) => {
    pending.current = { value };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const p = pending.current;
      pending.current = null;
      if (p) fnRef.current(p.value);
    }, ms);
  });
  return call.current;
}
