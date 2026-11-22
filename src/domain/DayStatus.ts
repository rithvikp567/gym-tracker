import type { LocalDate } from "./LocalDate";

/**
 * done    – a workout was logged (green dot)
 * missed  – a planned training day in the past with nothing logged (red dot)
 * planned – a planned training day today or later
 * rest    – nothing planned and nothing logged
 */
export type DayStatus = "done" | "missed" | "planned" | "rest";

export interface DayFacts {
  date: LocalDate;
  today: LocalDate;
  planned: boolean;
  workedOut: boolean;
  /** First day anything was logged; days before it are never "missed". */
  trackingStart: LocalDate | null;
}

export function dayStatus({ date, today, planned, workedOut, trackingStart }: DayFacts): DayStatus {
  if (workedOut) return "done";
  if (!planned) return "rest";
  const inPast = date.isBefore(today);
  const tracked = trackingStart !== null && !date.isBefore(trackingStart);
  return inPast && tracked ? "missed" : inPast ? "rest" : "planned";
}
