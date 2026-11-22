import type { LocalDate } from "../domain/LocalDate";
import { Session, type SessionData } from "../domain/Session";
import { Split, type SplitData } from "../domain/Split";
import { WorkoutDay, type WorkoutDayData } from "../domain/WorkoutDay";
import { Emitter } from "../lib/Emitter";
import type {
  ChangeFeed,
  Clock,
  Repositories,
  SessionRepository,
  SplitRepository,
  WorkoutDayRepository,
} from "../services/ports";
import type { RecordStore } from "./RecordStore";

/**
 * Stamps a strictly increasing `updatedAt` on every local save, so the newest edit
 * always wins during sync even when two saves land in the same millisecond.
 */
class Stamper {
  private last = 0;
  constructor(private readonly clock: Clock) {}
  next(): string {
    this.last = Math.max(this.clock.now().getTime(), this.last + 1);
    return new Date(this.last).toISOString();
  }

  /** A record was saved with an older chosen stamp (a repair): saves after it still come later. */
  passed(stamp: number): void {
    this.last = Math.max(this.last, stamp);
  }
}

class StoreWorkoutDays implements WorkoutDayRepository {
  constructor(private readonly store: RecordStore, private readonly stamp: Stamper, private readonly changed: () => void) {}

  async all(): Promise<WorkoutDay[]> {
    const rows = await this.store.getAll<WorkoutDayData>("workout_days");
    return rows.filter((r) => !r.deleted).map(WorkoutDay.from).sort((a, b) => a.order - b.order);
  }

  async get(id: string): Promise<WorkoutDay | undefined> {
    const row = await this.store.get<WorkoutDayData>("workout_days", id);
    return row && !row.deleted ? WorkoutDay.from(row) : undefined;
  }

  async save(day: WorkoutDay): Promise<WorkoutDay> {
    const stamped = day.withUpdatedAt(this.stamp.next());
    await this.store.putMany("workout_days", [stamped.toJSON()], "local");
    this.changed();
    return stamped;
  }

  async saveMany(days: WorkoutDay[]): Promise<void> {
    if (!days.length) return;
    await this.store.putMany("workout_days", days.map((d) => d.withUpdatedAt(this.stamp.next()).toJSON()), "local");
    this.changed();
  }
}

class StoreSessions implements SessionRepository {
  constructor(private readonly store: RecordStore, private readonly stamp: Stamper, private readonly changed: () => void) {}

  async get(id: string): Promise<Session | undefined> {
    const row = await this.store.get<SessionData>("sessions", id);
    return row && !row.deleted ? Session.from(row) : undefined;
  }

  async all(): Promise<Session[]> {
    const rows = await this.store.getAll<SessionData>("sessions");
    return rows
      .filter((r) => !r.deleted)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map(Session.from);
  }

  async forWorkoutDay(workoutDayId: string): Promise<Session[]> {
    return (await this.all()).filter((s) => s.workoutDayId === workoutDayId);
  }

  async onDate(date: LocalDate): Promise<Session[]> {
    const iso = date.toString();
    return (await this.all()).filter((s) => s.isoDate === iso);
  }

  async save(session: Session): Promise<Session> {
    const stamped = session.withUpdatedAt(this.stamp.next());
    await this.store.putMany("sessions", [stamped.toJSON()], "local");
    this.changed();
    return stamped;
  }

  async saveMany(sessions: Session[]): Promise<void> {
    if (!sessions.length) return;
    await this.store.putMany("sessions", sessions.map((s) => s.withUpdatedAt(this.stamp.next()).toJSON()), "local");
    this.changed();
  }

  async saveRepairs(sessions: Session[]): Promise<number> {
    if (!sessions.length) return 0;
    const repairs = sessions.map((s) => ({
      record: s.withUpdatedAt(new Date(Date.parse(s.updatedAt) + 1).toISOString()).toJSON(),
      basedOn: s.updatedAt,
    }));
    const saved = new Set(await this.store.putIfUnchanged("sessions", repairs));
    for (const { record } of repairs) if (saved.has(record.id)) this.stamp.passed(Date.parse(record.updatedAt));
    if (saved.size) this.changed();
    return saved.size;
  }
}

class StoreSplit implements SplitRepository {
  constructor(private readonly store: RecordStore, private readonly stamp: Stamper, private readonly changed: () => void) {}

  async get(): Promise<Split> {
    const row = await this.store.get<SplitData>("splits", Split.DEFAULT_ID);
    return row ? Split.from(row) : Split.empty();
  }

  async save(split: Split): Promise<Split> {
    const stamped = split.withUpdatedAt(this.stamp.next());
    await this.store.putMany("splits", [stamped.toJSON()], "local");
    this.changed();
    return stamped;
  }
}

/** Repositories backed by any RecordStore. */
export class StoreRepositories implements Repositories {
  readonly days: WorkoutDayRepository;
  readonly sessions: SessionRepository;
  readonly split: SplitRepository;
  private readonly emitter = new Emitter();
  readonly changes: ChangeFeed = this.emitter;

  constructor(readonly store: RecordStore, clock: Clock, onLocalWrite: () => void = () => {}) {
    const stamp = new Stamper(clock);
    const changed = () => {
      this.emitter.emit();
      onLocalWrite();
    };
    this.days = new StoreWorkoutDays(store, stamp, changed);
    this.sessions = new StoreSessions(store, stamp, changed);
    this.split = new StoreSplit(store, stamp, changed);
  }

  /** Sync calls this after applying records from another device. */
  notifyExternalChange(): void {
    this.emitter.emit();
  }
}
