import { ExerciseLog } from "../domain/ExerciseLog";
import type { LoadUnit } from "../domain/Load";
import { LocalDate, type Weekday } from "../domain/LocalDate";
import { Session } from "../domain/Session";
import { SetEntry } from "../domain/SetEntry";
import { WorkoutDay } from "../domain/WorkoutDay";
import type { Clock, Repositories } from "../services/ports";

/**
 * Sample data for `?demo` (stored in memory only), so the screens can be previewed and
 * screenshotted without touching real data.
 */
type DemoExercise = [name: string, sets: number, reps: string, start: number, step: number, extra?: { unit?: LoadUnit; retiredAfterWeek?: number }];

const PLAN: { name: string; weekdays: Weekday[]; exercises: DemoExercise[] }[] = [
  {
    name: "Upper 1",
    weekdays: [0],
    exercises: [
      ["Pulldown", 2, "8", 160, 2.5],
      ["Incline chest press", 3, "8", 70, 1.5],
      ["Pull thru", 2, "8", 62.5, 1],
      ["Tricep push down", 2, "8", 55, 1.2],
      ["Bicep curl", 2, "8", 35, 0.6],
      ["Cable shoulder", 3, "8", 15, 0.3],
    ],
  },
  {
    name: "Lower",
    weekdays: [1, 4],
    exercises: [
      ["Calf", 3, "12", 250, 3],
      ["RDL", 2, "8", 225, 2.5],
      ["Squat", 3, "8", 240, 4],
      ["Ext", 3, "10", 265, 2],
      ["Curl", 3, "8", 140, 1.5],
      ["Leg press", 2, "10", 2, 0.06, { unit: "plates" }],
      ["Hack squat", 3, "8", 180, 3, { retiredAfterWeek: 8 }],
    ],
  },
  {
    name: "Upper 2",
    weekdays: [3],
    exercises: [
      ["Seated row", 2, "8", 165, 1.5],
      ["Flys", 3, "8", 70, 1.5],
      ["Shrugs", 2, "10", 155, 2],
      ["Cable delt", 2, "8", 15, 0.4],
      ["JM press", 2, "8", 165, 3],
      ["Rear delt", 2, "10", 17.5, 0.5],
    ],
  },
  { name: "Abs/Cardio", weekdays: [], exercises: [["Leg raises", 3, "12", 0, 0], ["Weighted crunches", 3, "8", 20, 0.3]] },
];

export async function seedDemoData(repos: Repositories, clock: Clock): Promise<void> {
  const today = LocalDate.today(clock.now());
  const start = today.startOfWeek().addDays(-7 * 20);
  let split = await repos.split.get();
  const days: WorkoutDay[] = [];

  PLAN.forEach((plan, order) => {
    let day = WorkoutDay.create(plan.name, order);
    if (plan.name === "Abs/Cardio") {
      day = day.addExercise("Cardio", "check");
      const cardio = day.activeExercises()[0]!;
      day = day.withExercise(cardio.with({ targetText: "45 min walk" }));
    }
    for (const [name, sets, reps, , , extra] of plan.exercises) {
      day = day.addExercise(name);
      const ex = day.activeExercises().at(-1)!;
      day = day.withExercise(ex.with({ targetSets: sets, targetReps: reps, unit: extra?.unit ?? "lb" }));
    }
    days.push(day);
    for (const wd of plan.weekdays) split = split.withWeekday(wd, day.id);
  });

  const random = seeded(7);
  const sessions: Session[] = [];
  for (let date = start; date.isBefore(today); date = date.addDays(1)) {
    const weeks = start.daysUntil(date) / 7;
    const plannedId = split.plannedFor(date);
    const isCardioDay = !plannedId && (date.weekday() === 2 || date.weekday() === 5);
    const day = plannedId ? days.find((d) => d.id === plannedId) : isCardioDay ? days[3] : undefined;
    if (!day || random() < 0.12) continue; // the occasional missed day
    let session = Session.start(day.id, date);
    for (const ex of day.activeExercises()) {
      if (ex.kind === "check") {
        session = session.withLog(ExerciseLog.empty(ex.id).withDone(random() > 0.2));
        continue;
      }
      const plan = PLAN.find((p) => p.name === day.name)!.exercises.find((e) => e[0] === ex.name)!;
      const [, sets, reps, base, step, extra] = plan;
      if (extra?.retiredAfterWeek !== undefined && weeks > extra.retiredAfterWeek) continue;
      const round = extra?.unit === "plates" ? 0.5 : 2.5;
      const weight = base ? Math.round((base + step * weeks + (random() - 0.5) * step * 2) / round) * round : null;
      const target = Number(reps);
      const entries = Array.from({ length: sets }, (_, i) => new SetEntry(weight, Math.max(4, target - i + Math.round(random() * 2 - 1))));
      let log = ExerciseLog.empty(ex.id).withSets(entries);
      if (random() < 0.06) log = log.withNote("Last set was a grind, stay here next week");
      session = session.withLog(log);
    }
    sessions.push(session);
  }

  // Exercises that were swapped out partway through keep their history as "removed".
  for (const [i, plan] of PLAN.entries()) {
    for (const [name, , , , , extra] of plan.exercises) {
      const ex = days[i]!.activeExercises().find((e) => e.name === name);
      if (ex && extra?.retiredAfterWeek !== undefined) days[i] = days[i]!.archiveExercise(ex.id);
    }
  }

  await repos.days.saveMany(days);
  await repos.split.save(split);
  await repos.sessions.saveMany(sessions);
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
