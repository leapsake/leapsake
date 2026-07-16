import type { CoreApi, GenderResult, SyncStatus } from "@leapsake/core";
import { contextBridge, ipcRenderer } from "electron";
import { API_CHANNELS } from "../shared/api-channels.js";
import { buildBridgeApi } from "../shared/ipc-bridge.js";

/**
 * The single typed surface exposed to the renderer as `window.api`: a
 * `CoreApi`-shaped tree of thin `ipcRenderer.invoke` wrappers, generated from the
 * shared channel manifest so it can never drift from core (the renderer never
 * touches SQLite or Node directly). `Api` is exported below so the renderer
 * derives its types from here.
 *
 * A Person's or Pet's tags are saved alongside it (the create/update calls carry
 * the full desired tag-name list), so they commit in the same transaction as the
 * entity itself. `window.sync` and `window.boot` below are *not* part of
 * `CoreApi` (event subscriptions, key custody), so they stay hand-written.
 */
const api: CoreApi = buildBridgeApi(API_CHANNELS, (channel, args) =>
  ipcRenderer.invoke(channel, ...args),
);

contextBridge.exposeInMainWorld("api", api);

/**
 * The sync/account custody surface, exposed as a **separate** `window.sync`
 * bridge rather than folded into `window.api`. Enabling sync is not a
 * {@link CoreApi} operation — it derives a KEK in the main process and touches
 * the OS keystore — so keeping it off the generated `window.api` surface above
 * stops the IPC contract and core from drifting. `enable` returns the one-time
 * recovery key already base64-encoded for display; the renderer shows it once.
 */
const sync = {
  status: (): Promise<SyncStatus> => ipcRenderer.invoke("sync:status"),
  lookup: (args: {
    username: string;
    relayUrl: string;
  }): Promise<{ exists: boolean }> => ipcRenderer.invoke("sync:lookup", args),
  enable: (args: {
    username: string;
    password: string;
    relayUrl: string;
  }): Promise<{ accountId: string; recoveryKey: string }> =>
    ipcRenderer.invoke("sync:enable", args),
  join: (args: {
    username: string;
    password: string;
    relayUrl: string;
    // `duplicateCount` is how many possible duplicates the join surfaced between
    // this device's pre-existing people and the account's — a prompt to review.
  }): Promise<{ duplicateCount: number }> =>
    ipcRenderer.invoke("sync:join", args),
  recover: (args: {
    username: string;
    recoveryPhrase: string;
    newPassword: string;
    relayUrl: string;
  }): Promise<{ duplicateCount: number }> =>
    ipcRenderer.invoke("sync:recover", args),
  syncNow: (): Promise<{ at: number }> => ipcRenderer.invoke("sync:now"),
  /**
   * Re-authenticate this device after the account password was reset on another
   * device (a sync 401): re-derive this device's relay credential from the
   * re-entered password. The master key is untouched. Resolves once a sync has
   * been kicked; rejects with a friendly message on a wrong password.
   */
  reauthenticate: (password: string): Promise<void> =>
    ipcRenderer.invoke("sync:reauthenticate", { password }),
  clear: (): Promise<void> => ipcRenderer.invoke("sync:clear"),
  /**
   * Factory reset: erase all local data, keys, and the recovery sidecar, then
   * relaunch into a first-run state. Unlike {@link clear} (which keeps the data
   * and master key so sync can be re-enabled), this is unrecoverable unless the
   * account was synced. The app relaunches on success, so the returned promise
   * never resolves in practice — the caller does not await a result.
   */
  factoryReset: (): Promise<void> => ipcRenderer.invoke("app:factoryReset"),
  /** Reveal this device's recovery phrase (the words back into the data). */
  revealRecoveryPhrase: (): Promise<string> =>
    ipcRenderer.invoke("sync:revealRecoveryPhrase"),
  /** Read this install's "Sync automatically" preference (default true). */
  getAutoSync: (): Promise<boolean> => ipcRenderer.invoke("sync:getAutoSync"),
  /** Persist + apply the "Sync automatically" preference for this install. */
  setAutoSync: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("sync:setAutoSync", enabled),
  /**
   * Subscribe to background-sync activity (interval / focus / write-kicked runs,
   * not just the manual button), so the renderer can keep its "last synced" line
   * fresh. Returns an unsubscribe function. The payload carries either a
   * completion time or a non-fatal error message, plus `changed` (a pull applied
   * records) so the renderer can revalidate the active route.
   */
  onActivity: (
    listener: (payload: {
      at?: number;
      error?: string;
      changed?: boolean;
      needsReauth?: boolean;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: {
        at?: number;
        error?: string;
        changed?: boolean;
        needsReauth?: boolean;
      },
    ) => listener(payload);
    ipcRenderer.on("sync:activity", handler);
    return () => ipcRenderer.removeListener("sync:activity", handler);
  },
};

contextBridge.exposeInMainWorld("sync", sync);

export type Sync = typeof sync;

/**
 * The **boot gate** bridge: the renderer mounts before the database is open, so
 * it can host the at-rest recovery prompt when this device's enclave key is gone
 * but the encrypted file + recovery sidecar survive (encryption `model.md` §6).
 * `status` is the race-safe initial read (an event may fire before the renderer
 * subscribes); `onRecoveryNeeded` carries the previous attempt's error on a retry;
 * `onReady` fires once the core is fully initialized and the app may render.
 */
const boot = {
  status: (): Promise<{
    phase: "starting" | "recovering" | "ready";
    error?: string;
  }> => ipcRenderer.invoke("boot:status"),
  submitRecoveryPhrase: (phrase: string): Promise<void> =>
    ipcRenderer.invoke("boot:recovery", phrase),
  onRecoveryNeeded: (listener: (error?: string) => void): (() => void) => {
    const handler = (_event: unknown, error?: string) => listener(error);
    ipcRenderer.on("boot:recovery-needed", handler);
    return () => ipcRenderer.removeListener("boot:recovery-needed", handler);
  },
  onReady: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on("boot:ready", handler);
    return () => ipcRenderer.removeListener("boot:ready", handler);
  },
};

contextBridge.exposeInMainWorld("boot", boot);

export type Boot = typeof boot;

export type { GenderResult };

// The renderer derives its `window.api` contract from the client-agnostic core
// surface, so the IPC bridge and core can never drift. `api` above is the
// generated `ipcRenderer.invoke` implementation of this same shape, built from
// the shared channel manifest; the `ApiChannel` exhaustiveness check keeps the
// manifest complete.
export type Api = CoreApi;
