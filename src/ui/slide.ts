import { useMemo } from "react";

/**
 * Which side the next workout/day screen slides in from. Set right before navigating; the
 * screen that renders next reads it once.
 */
export type SlideDirection = "back" | "forward";

let pending: SlideDirection | null = null;

export function slideNext(direction: SlideDirection): void {
  pending = direction;
}

/** The direction for this screen (null = no animation). `key` changes once per navigation. */
export function useSlide(key: string): SlideDirection | null {
  return useMemo(() => {
    const direction = pending;
    pending = null;
    return direction;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
