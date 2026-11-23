import { ExerciseLog } from "../domain/ExerciseLog";
import { platesToPounds, type LoadUnit } from "../domain/Load";
import { LocalDate, type Weekday } from "../domain/LocalDate";
import { Session } from "../domain/Session";
import { SetEntry } from "../domain/SetEntry";
import { WeekTally } from "../domain/social/WeekTally";
import { Split } from "../domain/Split";
import { WorkoutDay } from "../domain/WorkoutDay";
import { MemorySocialServer } from "../data/MemorySocial";
import type { Clock, FriendRecords, Repositories, SocialGateway } from "../services/ports";
import { SocialService } from "../services/SocialService";

/**
 * Sample data for `?demo` (stored in memory only), so the screens can be previewed and
 * screenshotted without touching real data.
 */
type DemoExercise = [
  name: string,
  sets: number,
  reps: string,
  start: number,
  step: number,
  /** poundsUntilWeek: a plates exercise logged in pounds for its first weeks (saved with "lb" on each log). */
  extra?: { unit?: LoadUnit; retiredAfterWeek?: number; poundsUntilWeek?: number },
];

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
      ["Leg press", 2, "10", 2, 0.06, { unit: "plates", poundsUntilWeek: 6 }],
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
      // Older demo logs carry no unit (they follow the exercise), like data saved before units were stored.
      const inPounds = extra?.unit === "plates" && weeks < (extra.poundsUntilWeek ?? 0);
      const round = extra?.unit === "plates" && !inPounds ? 0.5 : 2.5;
      const value = base ? base + step * weeks + (random() - 0.5) * step * 2 : 0;
      const weight = base ? Math.round((inPounds ? platesToPounds(value) : value) / round) * round : null;
      const target = Number(reps);
      const entries = Array.from({ length: sets }, (_, i) => new SetEntry(weight, Math.max(4, target - i + Math.round(random() * 2 - 1))));
      let log = ExerciseLog.empty(ex.id).withSets(entries).withUnit(inPounds ? "lb" : undefined);
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

/** The demo's own account id, and its friends' (see seedDemoSocial). */
export const DEMO_ME = "demo-me";

/**
 * Sample friends for `?demo`: two friends with workouts to look at (Alex's carry a note, which
 * the page never shows), Maya without any logged yet, a request each way, a room you're in and
 * an invite to another.
 */
export function seedDemoSocial(clock: Clock): SocialGateway {
  const server = new MemorySocialServer();
  const today = LocalDate.today(clock.now());
  const thisWeek = today.startOfWeek();
  const lastWeek = thisWeek.addDays(-7);

  server.addProfile(DEMO_ME, "demo_you", "You");
  const people = {
    alex: server.addProfile("demo-alex", "alex_lifts", "Alex"),
    maya: server.addProfile("demo-maya", "maya_k", "Maya"),
    chris: server.addProfile("demo-chris", "chris_b", "Chris"),
    jordan: server.addProfile("demo-jordan", "jdawg", "Jordan"),
    sam: server.addProfile("demo-sam", "sam_lifts", ""),
  };
  server.befriend(DEMO_ME, people.alex.id);
  server.befriend(people.maya.id, DEMO_ME);
  server.befriend(people.chris.id, DEMO_ME);
  server.befriend(people.jordan.id, DEMO_ME, "pending");
  server.befriend(DEMO_ME, people.sam.id, "pending");
  server.befriend(people.alex.id, people.chris.id);

  // Friends with workouts score what their workouts say, as the app publishes them (D53).
  for (const [id, plan, seed] of [
    [people.alex.id, [["Push", [0, 3]], ["Pull", [1, 4]], ["Legs", [2]]], 11],
    [people.chris.id, [["Full body", [0, 2, 4]]], 23],
  ] as const) {
    const friend = demoFriend(today, plan, seed);
    server.setRecords(id, friend.records);
    const { thisWeek: now, lastWeek: before, streak } = SocialService.tallies(friend.sessions, friend.split, today);
    server.setTally(id, now, streak);
    server.setTally(id, before, streak);
  }
  server.setTally(people.maya.id, WeekTally.of(thisWeek, 3, 1), 0);
  server.setTally(people.maya.id, WeekTally.of(lastWeek, 3, 2), 0);

  server.seedRoom("Gym bros", DEMO_ME, [
    { id: people.alex.id, status: "joined" },
    { id: people.chris.id, status: "joined" },
    { id: people.maya.id, status: "invited" },
  ]);
  server.seedRoom("Leg day club", people.chris.id, [{ id: DEMO_ME, status: "invited" }]);

  return server.as(() => DEMO_ME);
}

/** A friend's workout days (one exercise list each), split, and four weeks of sessions up to today. */
function demoFriend(
  today: LocalDate,
  plan: readonly (readonly [name: string, weekdays: readonly Weekday[]])[],
  seed: number,
): { records: FriendRecords; sessions: Session[]; split: Split } {
  const random = seeded(seed);
  let split = Split.empty();
  const days = plan.map(([name, weekdays], order) => {
    let day = WorkoutDay.create(name, order);
    for (const exercise of ["Main lift", "Second lift", "Accessory"]) day = day.addExercise(`${name} ${exercise.toLowerCase()}`);
    for (const wd of weekdays) split = split.withWeekday(wd, day.id);
    return day;
  });
  const sessions: Session[] = [];
  for (let date = today.startOfWeek().addDays(-21); !date.isAfter(today); date = date.addDays(1)) {
    const day = days.find((d) => d.id === split.plannedFor(date));
    if (!day || random() < 0.15) continue;
    let session = Session.start(day.id, date);
    day.activeExercises().forEach((ex, i) => {
      const weight = Math.round((185 - i * 50 + random() * 10) / 5) * 5;
      let log = ExerciseLog.empty(ex.id).withSets([new SetEntry(weight, 8), new SetEntry(weight, 7)]).withUnit("lb");
      if (i === 0) log = log.withNote("Private note: knee felt off");
      session = session.withLog(log);
    });
    sessions.push(session);
  }
  return {
    records: { days: days.map((d) => d.toJSON()), split: split.toJSON(), sessions: sessions.map((s) => s.toJSON()) },
    sessions,
    split,
  };
}
