import { formatNumber } from "./SetEntry";

/**
 * How an exercise's weight is written down:
 *   lb      – pounds on the stack or bar (the default)
 *   plates  – 45 lb plates on ONE side, with .5 meaning a 25 lb plate (leg press, hack squat…)
 */
export type LoadUnit = "lb" | "plates";

export const PLATE_LB = 45;
export const HALF_PLATE_LB = 25;

/**
 * Plates on one side → pounds of plates on both sides (the sled or bar isn't counted).
 * 2.5 = two 45s and a 25 per side = 230 lb. Between halves each half scales on its own plate:
 * .0–.5 grows toward the 25, .5–1 adds the 20 more that makes it a 45 (1.75 → 160 lb), so more
 * plates always weigh more. Rounded to hundredths, like the labels.
 */
export function platesToPounds(platesPerSide: number): number {
  const whole = Math.floor(platesPerSide);
  const rest = platesPerSide - whole;
  const toHalf = Math.min(rest, 0.5) * 2 * HALF_PLATE_LB;
  const toWhole = Math.max(rest - 0.5, 0) * 2 * (PLATE_LB - HALF_PLATE_LB);
  return Math.round(2 * (whole * PLATE_LB + toHalf + toWhole) * 100) / 100;
}

/**
 * A weight in another unit, when that's exact: plates → pounds converts; pounds → plates gives
 * null, because which plates make up a weight is a guess.
 */
export function convertLoad(value: number, from: LoadUnit, to: LoadUnit): number | null {
  if (from === to) return value;
  return from === "plates" && to === "lb" ? platesToPounds(value) : null;
}

/** The unit as a suffix after a weight label: "" for pounds, " pl" for plates. */
export function unitSuffix(unit: LoadUnit): string {
  return unit === "plates" ? " pl" : "";
}

/** "185" or "2.5 pl". */
export function formatLoad(value: number, unit: LoadUnit): string {
  return `${formatNumber(value)}${unitSuffix(unit)}`;
}

/** "pounds" or "plates", for sentences. */
export function unitName(unit: LoadUnit): string {
  return unit === "plates" ? "plates" : "pounds";
}
