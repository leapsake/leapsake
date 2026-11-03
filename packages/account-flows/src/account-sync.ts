import type { KeyStore } from "@leapsake/crypto";
import type { SqliteDriver, SyncableRepo } from "@leapsake/data";
import { getSyncStatus } from "@leapsake/key-custody";
import type { SyncRow } from "@leapsake/schema";
import {
  type SyncScheduler,
  createSyncScheduler,
  runAccountSync,
} from "@leapsake/sync";
import { type RelayFailure, relayFailure } from "./relay-error.js";

/** What one sync run did, for a client to show; `unauthorized` means the
 *  password was changed on another device. */
export type SyncActivity =
  | { kind: "synced"; at: number; changed: boolean }
  | { kind: "failed"; reason: RelayFailure | "other"; cause: unknown };

/**
 * The sync loop for the open store: a scheduler whose runs push and pull for
 * a relay-bound account, and skip quietly for any other.
 */
export function createAccountSync(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  /** The key session's master key; none (accountless, Degraded) never syncs. */
  masterKey: Uint8Array | undefined;
  /** What may leave the device: core's `syncableRepos`. */
  repos: SyncableRepo<SyncRow>[];
  autoEnabled?: boolean;
  onActivity: (activity: SyncActivity) => void;
}): SyncScheduler {
  const { keyStore, driver, masterKey, repos, onActivity } = opts;
  return createSyncScheduler({
    autoEnabled: opts.autoEnabled,
    async run() {
      if (masterKey === undefined) return undefined;
      if ((await getSyncStatus({ driver })).relayUrl === undefined) {
        return undefined;
      }
      return runAccountSync({ keyStore, driver, masterKey, repos });
    },
    onResult: ({ at, applied }) =>
      onActivity({ kind: "synced", at, changed: (applied ?? 0) > 0 }),
    onError: (cause) =>
      onActivity({
        kind: "failed",
        reason: relayFailure(cause) ?? "other",
        cause,
      }),
  });
}
