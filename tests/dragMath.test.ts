import { describe, expect, it } from "vitest";
import { clampDrag, dropIndex, edgeScroll, moveIndex, pressIntent, shiftFor, stepOf, swipeOffset, swipeOpens, type Slot } from "../src/ui/hooks/dragMath";

/** Four closed day tiles, 80 px tall, 8 px apart, from y = 100. */
const tiles: Slot[] = [0, 1, 2, 3].map((i) => ({ top: 100 + i * 88, height: 80 }));

describe("drag math", () => {
  it("lands a dragged item past each one whose middle its leading edge has crossed", () => {
    // Down: the bottom edge (180 + dy) passes the next middle (228) after 48 px.
    expect(dropIndex(tiles, 0, 0)).toBe(0);
    expect(dropIndex(tiles, 0, 47)).toBe(0);
    expect(dropIndex(tiles, 0, 49)).toBe(1);
    expect(dropIndex(tiles, 0, 137)).toBe(2);
    expect(dropIndex(tiles, 0, 500)).toBe(3);
    // Up: the top edge passes the previous middle.
    expect(dropIndex(tiles, 3, -47)).toBe(3);
    expect(dropIndex(tiles, 3, -49)).toBe(2);
    expect(dropIndex(tiles, 3, -500)).toBe(0);
    expect(dropIndex(tiles, 9, 10)).toBe(9); // not in the list
  });

  it("handles an open card among closed ones", () => {
    // A 600 px open card first, then two closed tiles.
    const slots: Slot[] = [
      { top: 100, height: 600 },
      { top: 708, height: 80 },
      { top: 796, height: 80 },
    ];
    // The open card's bottom (700) reaches the next tile's middle (748) after 48 px, not 300.
    expect(dropIndex(slots, 0, 49)).toBe(1);
    // A closed tile dragged up passes the open card once its top crosses the card's middle (400).
    expect(dropIndex(slots, 2, -395)).toBe(1);
    expect(dropIndex(slots, 2, -397)).toBe(0);
    expect(stepOf(slots, 0)).toBe(608);
    expect(stepOf(slots, 2)).toBe(88);
  });

  it("moves the passed items into the room the dragged one left", () => {
    const step = stepOf(tiles, 0);
    expect(step).toBe(88);
    // Item 0 held over place 2: items 1 and 2 move up one step, 3 stays.
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, step))).toEqual([0, -88, -88, 0]);
    // Item 3 held over place 1: items 1 and 2 move down.
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, step))).toEqual([0, 88, 88, 0]);
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 2, 2, step))).toEqual([0, 0, 0, 0]);
    // The last item's gap comes from the one before it; a lone item has none.
    expect(stepOf(tiles, 3)).toBe(88);
    expect(stepOf([{ top: 0, height: 50 }], 0)).toBe(50);
  });

  it("keeps a dragged item within the list", () => {
    expect(clampDrag(tiles, 1, -500)).toBe(-88);
    expect(clampDrag(tiles, 1, 500)).toBe(176);
    expect(clampDrag(tiles, 1, 30)).toBe(30);
    expect(clampDrag([], 0, 30)).toBe(0);
  });

  it("moves one entry to a new place in a copy", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveIndex(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveIndex(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveIndex(ids, 1, 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveIndex(ids, 7, 0)).toEqual(ids);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("tells a tap, a scroll, a swipe and a mouse drag apart before the hold is up", () => {
    const finger = { slop: 8, mouse: false, canSwipe: true, open: false };
    expect(pressIntent(3, 5, finger)).toBeNull(); // still a tap, or a hold
    expect(pressIntent(2, 30, finger)).toBe("none"); // scrolling the page
    expect(pressIntent(30, 6, finger)).toBe("swipe"); // rightward: open
    expect(pressIntent(-30, 6, finger)).toBe("none"); // leftward on a closed one
    expect(pressIntent(-30, 6, { ...finger, open: true })).toBe("swipe"); // leftward on the open one: close
    expect(pressIntent(30, 6, { ...finger, canSwipe: false })).toBe("none");
    const mouse = { slop: 5, mouse: true, canSwipe: true, open: false };
    expect(pressIntent(1, 12, mouse)).toBe("drag"); // a mouse drags at once
    expect(pressIntent(20, 4, mouse)).toBe("swipe");
    expect(pressIntent(-20, 4, mouse)).toBe("none");
    expect(pressIntent(-20, 4, { ...mouse, canSwipe: false })).toBe("drag"); // a handle: any way
  });

  it("follows the finger while swiping, stretching past open, and opens past half way", () => {
    expect(swipeOffset(0, 40, 84)).toBe(40);
    expect(swipeOffset(0, -40, 84)).toBe(0);
    expect(swipeOffset(0, 114, 84)).toBe(94); // 30 px past open moves 10
    expect(swipeOffset(84, -30, 84)).toBe(54); // closing from open
    expect(swipeOpens(43, 84)).toBe(true);
    expect(swipeOpens(42, 84)).toBe(false);
  });

  it("scrolls the page near the top and bottom edges while dragging, faster closer in", () => {
    expect(edgeScroll(400, 0, 800)).toBe(0);
    expect(edgeScroll(40, 0, 800)).toBeLessThan(0);
    expect(edgeScroll(0, 0, 800)).toBe(-14);
    expect(edgeScroll(760, 0, 800)).toBeGreaterThan(0);
    expect(edgeScroll(790, 0, 800)).toBeGreaterThan(edgeScroll(760, 0, 800));
    expect(edgeScroll(900, 0, 800)).toBe(14);
  });
});
