import { SocialError, type SocialGateway } from "../services/ports";

/** No backend for this site: the Social page says so, and nothing is tried. */
export class NoSocial implements SocialGateway {
  readonly available = false;

  private fail(): never {
    throw new SocialError("unavailable", "Social needs sync set up for this site.");
  }

  isUsernameFree(): Promise<boolean> { return this.fail(); }
  claimProfile(): Promise<never> { return this.fail(); }
  overview(): Promise<never> { return this.fail(); }
  requestFriend(): Promise<never> { return this.fail(); }
  answerFriend(): Promise<void> { return this.fail(); }
  unfriend(): Promise<void> { return this.fail(); }
  friendRecords(): Promise<never> { return this.fail(); }
  createRoom(): Promise<string> { return this.fail(); }
  invite(): Promise<void> { return this.fail(); }
  answerInvite(): Promise<void> { return this.fail(); }
  leaveRoom(): Promise<void> { return this.fail(); }
  publishTallies(): Promise<void> { return this.fail(); }
}
