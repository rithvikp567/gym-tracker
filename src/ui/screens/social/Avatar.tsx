import type { Profile } from "../../../domain/social/Profile";

/** A person's initial in a circle. */
export function Avatar({ profile, size = 32 }: { profile: Profile; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden>
      {profile.initial}
    </span>
  );
}

/** Avatar, name and handle on one line (the handle under the name when there's a display name). */
export function PersonLine({ profile, size }: { profile: Profile; size?: number }) {
  return (
    <span className="person">
      <Avatar profile={profile} size={size} />
      <span className="person-text">
        <span className="person-name">{profile.name}</span>
        {profile.displayName && <span className="person-handle">{profile.username.handle}</span>}
      </span>
    </span>
  );
}

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
