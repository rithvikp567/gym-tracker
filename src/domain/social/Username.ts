/**
 * The name friends find you by: 3–20 lowercase letters, digits or underscores, stored without
 * the "@". Typed with any case and an optional leading "@" ("@Sam_Lifts" → "sam_lifts").
 * The database enforces the same rule (supabase/migrations/0002_social.sql).
 */
export class Username {
  static readonly MIN = 3;
  static readonly MAX = 20;
  private static readonly PATTERN = /^[a-z0-9_]+$/;

  private constructor(readonly value: string) {}

  /** The username, or why it can't be one (a sentence to show under the field). */
  static parse(raw: string): Username | { problem: string } {
    const value = raw.trim().replace(/^@/, "").toLowerCase();
    if (value.length < Username.MIN) return { problem: `At least ${Username.MIN} characters.` };
    if (value.length > Username.MAX) return { problem: `At most ${Username.MAX} characters.` };
    if (!Username.PATTERN.test(value)) return { problem: "Letters, numbers and _ only." };
    return new Username(value);
  }

  /** For values that already passed the rule (read back from the server). */
  static trusted(value: string): Username {
    return new Username(value);
  }

  /** "@sam_lifts" */
  get handle(): string {
    return `@${this.value}`;
  }

  toString(): string {
    return this.value;
  }
}

export function isUsername(parsed: Username | { problem: string }): parsed is Username {
  return parsed instanceof Username;
}
