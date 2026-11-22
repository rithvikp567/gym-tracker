import { ExerciseLog, type ExerciseLogData } from "./ExerciseLog";
import { EPOCH, type Syncable } from "./ids";
import { LocalDate } from "./LocalDate";

export interface SessionData extends Syncable {
  /** ISO date */
  date: string;
  workoutDayId: string;
  logs: ExerciseLogData[];
}

/** One workout day done on one date: the "cell" for that day. Immutable. */
export class Session {
  private constructor(
    private readonly data: Omit<SessionData, "logs">,
    private readonly logList: readonly ExerciseLog[],
  ) {}

  /**
   * Deterministic id: one session per workout day per date. Two devices that log the
   * same day offline end up editing the same record instead of creating duplicates.
   */
  static idFor(workoutDayId: string, date: LocalDate | string): string {
    return `${workoutDayId}:${date.toString()}`;
  }

  static start(workoutDayId: string, date: LocalDate): Session {
    return new Session(
      { id: Session.idFor(workoutDayId, date), workoutDayId, date: date.toString(), updatedAt: EPOCH, deleted: false },
      [],
    );
  }

  static from(data: SessionData): Session {
    const { logs, ...rest } = data;
    return new Session({ ...rest }, (logs ?? []).map(ExerciseLog.from));
  }

  get id(): string { return this.data.id; }
  get workoutDayId(): string { return this.data.workoutDayId; }
  get date(): LocalDate { return LocalDate.parse(this.data.date); }
  get isoDate(): string { return this.data.date; }
  get updatedAt(): string { return this.data.updatedAt; }
  get deleted(): boolean { return this.data.deleted; }
  get logs(): readonly ExerciseLog[] { return this.logList; }

  log(exerciseId: string): ExerciseLog | undefined {
    return this.logList.find((l) => l.exerciseId === exerciseId);
  }

  /** Replaces (or adds) the log for its exercise; empty logs are dropped. */
  withLog(log: ExerciseLog): Session {
    const others = this.logList.filter((l) => l.exerciseId !== log.exerciseId);
    const logs = log.hasContent() ? [...others, log] : others;
    return new Session({ ...this.data, deleted: false }, logs);
  }

  /** You trained: at least one exercise has numbers or is marked done. */
  isWorkout(): boolean {
    return !this.deleted && this.logList.some((l) => l.hasResult());
  }

  hasContent(): boolean {
    return !this.deleted && this.logList.some((l) => l.hasContent());
  }

  markDeleted(): Session {
    return new Session({ ...this.data, deleted: true }, this.logList);
  }

  withUpdatedAt(updatedAt: string): Session {
    return new Session({ ...this.data, updatedAt }, this.logList);
  }

  toJSON(): SessionData {
    return { ...this.data, logs: this.logList.map((l) => l.toJSON()) };
  }
}
