import type { Profile } from "./Profile";
import type { WeekTally } from "./WeekTally";

export type MemberStatus = "joined" | "invited";

/** Someone in a room: their profile, whether they've joined, and their scores. */
export interface RoomMember {
  profile: Profile;
  status: MemberStatus;
  /** This week's tally, once they've published one (they open the app). */
  thisWeek: WeekTally | null;
  lastWeek: WeekTally | null;
  streak: number;
}

/** A place on a leaderboard. People with the same score share a rank. */
export interface Standing {
  rank: number;
  member: RoomMember;
  tally: WeekTally | null;
}

/**
 * Ranks members on a week: share of planned workouts done (WeekTally.ratio), then more
 * workouts done, then the longer streak; ties share a rank and are listed by name. Members with
 * no tally for the week come last, unranked (rank 0).
 */
export function rankMembers(members: readonly RoomMember[], week: (m: RoomMember) => WeekTally | null): Standing[] {
  const scored = members.map((member) => ({ member, tally: week(member) }));
  const key = (s: { member: RoomMember; tally: WeekTally | null }) => [s.tally?.ratio ?? -1, s.tally?.done ?? -1, s.member.streak];
  scored.sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
    return a.member.profile.name.localeCompare(b.member.profile.name);
  });
  const standings: Standing[] = [];
  scored.forEach((s, i) => {
    const prev = standings[i - 1];
    if (!s.tally) {
      standings.push({ ...s, rank: 0 });
    } else if (prev?.tally && key(prev).every((v, j) => v === key(s)[j])) {
      standings.push({ ...s, rank: prev.rank });
    } else {
      standings.push({ ...s, rank: i + 1 });
    }
  });
  return standings;
}

export interface RoomData {
  id: string;
  name: string;
  ownerId: string;
  members: RoomMember[];
}

/** A group of friends competing on planned workouts done each week (D53). Immutable. */
export class Room {
  static readonly NAME_MAX = 40;

  private constructor(private readonly data: RoomData) {}

  static from(data: RoomData): Room {
    return new Room({ ...data, members: [...data.members] });
  }

  get id(): string { return this.data.id; }
  get name(): string { return this.data.name; }
  get ownerId(): string { return this.data.ownerId; }
  get members(): readonly RoomMember[] { return this.data.members; }

  /** Members who've joined (invited ones aren't on the board yet). */
  joined(): RoomMember[] {
    return this.data.members.filter((m) => m.status === "joined");
  }

  invited(): RoomMember[] {
    return this.data.members.filter((m) => m.status === "invited");
  }

  /** This week's leaderboard. */
  board(): Standing[] {
    return rankMembers(this.joined(), (m) => m.thisWeek);
  }

  /** Who topped last week (several on a tie), or none when nobody had a score. */
  lastWeekWinners(): RoomMember[] {
    return rankMembers(this.joined(), (m) => m.lastWeek)
      .filter((s) => s.rank === 1 && s.tally && s.tally.ratio > 0)
      .map((s) => s.member);
  }

  /** Where `userId` stands this week (0 = no score yet), or null when they aren't on the board. */
  rankOf(userId: string): number | null {
    return this.board().find((s) => s.member.profile.id === userId)?.rank ?? null;
  }

  has(userId: string): boolean {
    return this.data.members.some((m) => m.profile.id === userId);
  }
}

/** A room name as stored, or null when there's nothing left to store. */
export function cleanRoomName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, Room.NAME_MAX);
  return name || null;
}
