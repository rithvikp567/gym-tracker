import { formatNumber } from "./SetEntry";

/**
 * How an exercise's weight is written down:
 *   lb      – pounds on the stack or bar (the default)
 *   kg      – kilograms (a gym abroad, or kilo dumbbells next to pound machines)
 *   plates  – 45 lb plates on ONE side, with .5 meaning a 25 lb plate (leg press, hack squat…)
 */
export type LoadUnit = "lb" | "kg" | "plates";

/** The two units a weight can be typed or charted in (plates are only ever typed on their own exercise). */
export type WeightUnit = "lb" | "kg";

export const KG_PER_LB = 0.45359237;

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

/** To the nearest half: what a gym's weights can show (2.5 kg / 1.25 kg plates, 2.5 lb steps). */
function toHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * A weight in another unit, or null when that would be a guess. Plates → pounds is exact;
 * pounds ⇄ kilograms (and plates → kilograms, through pounds) round to the nearest half, so
 * 185 lb reads 84 kg and 80 kg reads 176.5 lb. Nothing becomes plates: which plates make up a
 * weight is a guess.
 */
export function convertLoad(value: number, from: LoadUnit, to: LoadUnit): number | null {
  if (from === to) return value;
  if (to === "plates") return null;
  const pounds = from === "plates" ? platesToPounds(value) : from === "kg" ? value / KG_PER_LB : value;
  if (to === "lb") return from === "plates" ? pounds : toHalf(pounds);
  return toHalf(pounds * KG_PER_LB);
}

/** The unit as a suffix after a weight label: "" for pounds, " kg", " pl" for plates. */
export function unitSuffix(unit: LoadUnit): string {
  return unit === "plates" ? " pl" : unit === "kg" ? " kg" : "";
}

/** "185", "84 kg" or "2.5 pl". */
export function formatLoad(value: number, unit: LoadUnit): string {
  return `${formatNumber(value)}${unitSuffix(unit)}`;
}

/** "pounds", "kilograms" or "plates", for sentences. */
export function unitName(unit: LoadUnit): string {
  return unit === "plates" ? "plates" : unit === "kg" ? "kilograms" : "pounds";
}
