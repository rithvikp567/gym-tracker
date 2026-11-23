import { Username } from "./Username";

export interface ProfileData {
  id: string;
  username: string;
  displayName: string;
}

/** How a person shows up to their friends: a username and an optional display name. Never their email. */
export class Profile {
  static readonly DISPLAY_NAME_MAX = 40;

  private constructor(
    readonly id: string,
    readonly username: Username,
    readonly displayName: string,
  ) {}

  static from(data: ProfileData): Profile {
    return new Profile(data.id, Username.trusted(data.username), (data.displayName ?? "").trim());
  }

  /** The display name, or the handle when there's none. */
  get name(): string {
    return this.displayName || this.username.handle;
  }

  /** One letter for the avatar circle. */
  get initial(): string {
    return (this.displayName || this.username.value).charAt(0).toUpperCase();
  }

  toJSON(): ProfileData {
    return { id: this.id, username: this.username.value, displayName: this.displayName };
  }
}

/** Trims a display name to what's stored (empty = none). */
export function cleanDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, Profile.DISPLAY_NAME_MAX);
}
