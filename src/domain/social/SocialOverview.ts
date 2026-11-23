import type { Profile } from "./Profile";
import type { Room } from "./Room";
import type { WeekTally } from "./WeekTally";

/** A friend as their list shows them: this week's score and their streak. */
export interface Friend {
  profile: Profile;
  thisWeek: WeekTally | null;
  streak: number;
}

/** An invitation to join a room. */
export interface RoomInvite {
  roomId: string;
  roomName: string;
  invitedBy: Profile | null;
}

/** Everything the Social page shows, loaded in one go. */
export interface SocialOverview {
  /** Null until a username is picked. */
  me: Profile | null;
  /** Friend requests sent to you. */
  incoming: Profile[];
  /** Requests you sent that haven't been answered. */
  outgoing: Profile[];
  friends: Friend[];
  invites: RoomInvite[];
  rooms: Room[];
}

/** What sending a friend request did. */
export type FriendRequestOutcome =
  /** Sent; they'll see it under Requests. */
  | "sent"
  /** They had already asked you, so you're friends now. */
  | "accepted"
  | "not-found"
  | "self"
  | "already-friends"
  | "already-requested";

export function describeOutcome(outcome: FriendRequestOutcome, handle: string): string {
  switch (outcome) {
    case "sent": return `Request sent to ${handle}.`;
    case "accepted": return `${handle} had already asked. You're friends now.`;
    case "not-found": return `Nobody goes by ${handle}.`;
    case "self": return "That's you.";
    case "already-friends": return `You're already friends with ${handle}.`;
    case "already-requested": return `You already asked ${handle}.`;
  }
}
