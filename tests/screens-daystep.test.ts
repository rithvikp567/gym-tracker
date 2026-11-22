import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalDate } from "../src/domain/LocalDate";
import type { DayTarget } from "../src/services/CalendarService";
import { rememberHomeDay } from "../src/ui/homePick";
import { stepToDay } from "../src/ui/hooks/useDayStep";
import { navigate } from "../src/ui/router";
import { slideNext } from "../src/ui/slide";

vi.mock("../src/ui/router", () => ({ navigate: vi.fn() }));
vi.mock("../src/ui/homePick", () => ({ rememberHomeDay: vi.fn() }));
vi.mock("../src/ui/slide", () => ({ slideNext: vi.fn() }));

const d = (iso: string) => LocalDate.parse(iso);

/** A calendar whose day lookup answers only when told to (it reads every session, so it can be slow). */
function slowCalendar() {
  let answer!: (target: DayTarget) => void;
  const calendar = {
    today: () => d("2026-11-20"),
    dayTarget: vi.fn(() => new Promise<DayTarget>((resolve) => (answer = resolve))),
  };
  return { calendar, answer: (target: DayTarget) => answer(target) };
}

beforeEach(() => vi.clearAllMocks());

describe("day arrows", () => {
  it("go to the next day's workout, replacing this screen", async () => {
    const { calendar, answer } = slowCalendar();
    const step = stepToDay(calendar, d("2026-11-17"), "upper", 1, () => true);
    answer({ kind: "workout", dayId: "lower" });
    await step;
    expect(calendar.dayTarget).toHaveBeenCalledWith(d("2026-11-18"), "upper");
    expect(slideNext).toHaveBeenCalledWith("forward");
    expect(rememberHomeDay).toHaveBeenCalledWith(d("2026-11-18"), d("2026-11-20"));
    expect(navigate).toHaveBeenCalledWith({ name: "session", dayId: "lower", date: "2026-11-18" }, { replace: true });
  });

  it("do nothing when the screen was left while the lookup ran", async () => {
    const { calendar, answer } = slowCalendar();
    let here = true;
    const step = stepToDay(calendar, d("2026-11-17"), "upper", -1, () => here);
    here = false; // Back to Home (or Last session) before the lookup answered
    answer({ kind: "pick" });
    await step;
    expect(navigate).not.toHaveBeenCalled();
    expect(rememberHomeDay).not.toHaveBeenCalled();
    expect(slideNext).not.toHaveBeenCalled();
  });
});
