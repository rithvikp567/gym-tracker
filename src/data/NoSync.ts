import { Emitter, type Unsubscribe } from "../lib/Emitter";
import type { SyncController, SyncStatus } from "../services/ports";

/** Used when no backend is configured: everything stays on this device. */
export class NoSync implements SyncController {
  readonly configured = false;
  private readonly emitter = new Emitter<SyncStatus>();
  private readonly current: SyncStatus = { state: "off", email: null, lastSyncedAt: null, message: null };

  status(): SyncStatus {
    return this.current;
  }

  subscribe(listener: (status: SyncStatus) => void): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  async signIn(): Promise<void> {
    throw new Error("Sync isn't set up for this site yet.");
  }

  async createAccount(): Promise<void> {
    throw new Error("Sync isn't set up for this site yet.");
  }

  async requestPasswordReset(): Promise<void> {
    throw new Error("Sync isn't set up for this site yet.");
  }

  async resetPassword(): Promise<void> {
    throw new Error("Sync isn't set up for this site yet.");
  }

  userId(): string | null {
    return null;
  }

  /** Nothing to sync with: preferences stay on this device. */
  attachPreferences(): void {}

  async signOut(): Promise<void> {}
  async syncNow(): Promise<void> {}
  requestSync(): void {}
}
