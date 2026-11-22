import type { Weekday } from "../domain/LocalDate";
import type { Split } from "../domain/Split";
import { WorkoutDay } from "../domain/WorkoutDay";
import type { Repositories } from "./ports";

/** Creating and editing workout days, their exercises, and the weekly split. */
export class SetupService {
  constructor(private readonly repos: Repositories) {}

  days(): Promise<WorkoutDay[]> {
    return this.repos.days.all();
  }

  split(): Promise<Split> {
    return this.repos.split.get();
  }

  async createDay(name: string): Promise<WorkoutDay> {
    const days = await this.days();
    const order = days.length ? Math.max(...days.map((d) => d.order)) + 1 : 0;
    return this.repos.days.save(WorkoutDay.create(name, order));
  }

  /** Applies an edit (rename, add/move/archive exercise…) to a day and saves it. */
  async updateDay(id: string, edit: (day: WorkoutDay) => WorkoutDay): Promise<WorkoutDay | undefined> {
    const day = await this.repos.days.get(id);
    if (!day) return undefined;
    return this.repos.days.save(edit(day));
  }

  async deleteDay(id: string): Promise<void> {
    const day = await this.repos.days.get(id);
    if (!day) return;
    await this.repos.days.save(day.markDeleted());
    const split = await this.split();
    if (split.pattern.includes(id)) await this.repos.split.save(split.without(id));
  }

  async moveDay(id: string, delta: -1 | 1): Promise<void> {
    const days = await this.days();
    const from = days.findIndex((d) => d.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= days.length) return;
    const reordered = [...days];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);
    await this.repos.days.saveMany(reordered.flatMap((d, i) => (d.order === i ? [] : [d.withOrder(i)])));
  }

  async setPlanned(weekday: Weekday, workoutDayId: string | null): Promise<void> {
    const split = await this.split();
    await this.repos.split.save(split.withWeekday(weekday, workoutDayId));
  }
}
