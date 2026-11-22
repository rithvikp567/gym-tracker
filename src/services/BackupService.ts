import type { Repositories } from "./ports";

/** A plain JSON copy of everything, for peace of mind before big changes. */
export class BackupService {
  constructor(private readonly repos: Repositories) {}

  async exportJson(): Promise<string> {
    const [days, sessions, split] = await Promise.all([
      this.repos.days.all(),
      this.repos.sessions.all(),
      this.repos.split.get(),
    ]);
    return JSON.stringify(
      {
        app: "gym-tracker",
        version: 1,
        exportedAt: new Date().toISOString(),
        workoutDays: days.map((d) => d.toJSON()),
        split: split.toJSON(),
        sessions: sessions.map((s) => s.toJSON()),
      },
      null,
      2,
    );
  }
}
