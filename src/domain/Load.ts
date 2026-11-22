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
 * 2.5 = two 45s and a 25 per side = 230 lb. Fractions between halves scale linearly.
 */
export function platesToPounds(platesPerSide: number): number {
  const whole = Math.floor(platesPerSide);
  const rest = platesPerSide - whole;
  return 2 * (whole * PLATE_LB + rest * 2 * HALF_PLATE_LB);
}

/** The unit as a suffix after a weight label: "" for pounds, " pl" for plates. */
export function unitSuffix(unit: LoadUnit): string {
  return unit === "plates" ? " pl" : "";
}

/** "185" or "2.5 pl". */
export function formatLoad(value: number, unit: LoadUnit): string {
  return `${formatNumber(value)}${unitSuffix(unit)}`;
}
