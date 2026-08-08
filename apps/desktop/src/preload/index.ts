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
  /**
   * Merge this device's **local-only account** into an existing synced one
   * (`encryption/model.md` §7.2.2): the store is re-homed under the synced
   * account's id, keeps every row, and from the next launch opens under *that*
   * account's password.
   *
   * The same argument shape as {@link join} on purpose, so one login form serves
   * both — but a distinct channel, because join is an accountless device's act
   * and this one retires an account.
   */
  merge: (args: {
    username: string;
    password: string;
    relayUrl: string;
  }): Promise<{ duplicateCount: number }> =>
    ipcRenderer.invoke("sync:merge", args),
  /**
   * **Start syncing an account that already exists on this computer** — bind a
   * relay to a local-only account (`model.md` §7.2). It publishes what the store
   * already holds: no password is asked for, no key is minted, no store is
   * converted, and the recovery phrase the user wrote down still opens the
   * account.
   *
   * The sibling of {@link merge}, and the other half of the local-only branch:
   * merge moves this data **into** an account that exists elsewhere, this
   * publishes the account that is **already here**.
   *
   * ⚠️ **`username-taken` resolves, it does not reject.** A taken handle is a
   * fork rather than a failure — it may be the user's own account on another
   * device (→ {@link merge}) or a stranger's (→ call this again with a different
   * name) — and only the user can say which. Every other failure still rejects.
   */
  bindRelay: (args: {
    username: string;
    relayUrl: string;
  }): Promise<
    | { status: "bound"; accountId: string; username: string }
    | { status: "username-taken"; username: string }
  > => ipcRenderer.invoke("sync:bindRelay", args),
  /**
   * Create an account on this device (model.md §7.2.1) — the act that turns
   * encryption on. Fully local. Resolves with the 24-word recovery phrase for its
   * one-time reveal, by which point the main process has already re-opened the
   * app around the converted store — there is nothing to restart.
   */
  createAccount: (args: {
    username: string;
    password: string;
  }): Promise<{ accountId: string; recoveryPhrase: string }> =>
    ipcRenderer.invoke("account:create", args),
  syncNow: (): Promise<{ at: number }> => ipcRenderer.invoke("sync:now"),
  /**
   * Re-authenticate this device after the account password was reset on another
   * device (a sync 401): re-derive this device's relay credential from the
   * re-entered password. The master key is untouched. Resolves once a sync has
   * been kicked; rejects with a friendly message on a wrong password.
   */
  reauthenticate: (password: string): Promise<void> =>
    ipcRenderer.invoke("sync:reauthenticate", { password }),
  /**
   * **Sign out** (`model.md` §7.3): close the store and forget the keys that open
   * it, so the password is needed to get back in. The data stays on this device,
   * encrypted — {@link forgetAccount} is the one that removes it.
   *
   * Fire and forget. The main process raises the unlock gate as part of this call
   * and the promise settles only once the user has passed it, so the caller should
   * *not* await it before navigating: `window.boot.onUnlockNeeded` is what tells
   * the renderer to switch, and it fires first.
   */
  signOut: (): Promise<void> => ipcRenderer.invoke("account:signOut"),
  /**
   * What the Forget-account confirmation needs to word itself (`model.md`
   * §7.3.1). `durableBackup` is whether the relay claims to keep a copy — it is
   * `false` whenever nobody said otherwise (no relay, unreachable relay, or the
   * usual case of a relay that does not advertise), which is what makes forgetting
   * the last device read as the deletion it is.
   */
  forgetInfo: (): Promise<{
    username?: string;
    relayUrl?: string;
    durableBackup: boolean;
  }> => ipcRenderer.invoke("account:forgetInfo"),
  /**
   * **Forget account** (`model.md` §7.3): remove this account, its store, and both
   * of its unlock doors from this device, leaving it in the accountless state a
   * fresh install is in. Local only — an account on a relay or another device is
   * untouched there. The main process reloads this renderer once the empty store
   * is open, so the caller has no completion state to render.
   */
  forgetAccount: (): Promise<void> => ipcRenderer.invoke("account:forget"),
  /**
   * Factory reset: erase all local data, keys, and the recovery sidecar, then
   * come back up in a first-run state. Unlike {@link clear} (which keeps the data
   * and master key so sync can be re-enabled), this is unrecoverable unless the
   * account was synced. The main process reloads this renderer once the fresh
   * store is open, so the caller has no completion state to render.
   */
  factoryReset: (): Promise<void> => ipcRenderer.invoke("app:factoryReset"),
  /**
   * Replace this device's recovery phrase, gated on the account password
   * (`model.md` §6). Returns the new phrase to show **once** — there is no way to
   * see it again — and `escrowPending`, which is `true` when the relay could not be
   * reached: until the next sync the *old* phrase is still what recovers the
   * account, and the caller must say so.
   */
  rotateRecoveryPhrase: (
    password: string,
  ): Promise<{ recoveryPhrase: string; escrowPending: boolean }> =>
    ipcRenderer.invoke("sync:rotateRecoveryPhrase", { password }),
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

/** Which doors the store being unlocked actually offers (`model.md` §7.5). */
export interface UnlockDoors {
  password: boolean;
  phrase: boolean;
}

/** The *Degraded* state as the renderer needs it: why, and whether this account
 *  has a relay (so the banner can say what actually stopped). */
interface DegradedCustody {
  detail: string;
  relayBound: boolean;
}

/**
 * The **boot gate** bridge: the renderer mounts before the database is open, so
 * it can host the at-rest unlock prompt when this device's enclave key is gone
 * but the encrypted file + a sidecar survive (encryption `model.md` §6, §7.5).
 *
 * The gate has two doors — the account **password** (primary) and the 24-word
 * **recovery phrase** (the forgot-password fallback) — and is told which ones this
 * store actually has, since a store written before the password door shipped only
 * offers the phrase. `status` is the race-safe initial read (an event may fire
 * before the renderer subscribes); `onUnlockNeeded` carries the previous attempt's
 * error on a retry; `onReady` fires once the core is initialized and the app may
 * render.
 *
 * `degraded` is the one piece here that outlives the gate: it is set when the store
 * opened but this device could not prove which master key is the account's (custody
 * slice 10, `model.md` §7.5). The app is fully usable — that is the point — so the
 * phase is still `ready`; sync is off until it is resolved, and the renderer keeps a
 * banner up for as long as it is set. Its `relayBound` says whether this account has
 * a relay at all, because that decides what the banner may honestly claim has
 * stopped.
 */
const boot = {
  status: (): Promise<{
    phase: "starting" | "recovering" | "ready";
    error?: string;
    doors: UnlockDoors;
    degraded?: DegradedCustody;
  }> => ipcRenderer.invoke("boot:status"),
  submitUnlock: (answer: {
    door: "password" | "phrase";
    secret: string;
  }): Promise<void> => ipcRenderer.invoke("boot:unlock", answer),
  onUnlockNeeded: (
    listener: (payload: { error?: string; doors: UnlockDoors }) => void,
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload: { error?: string; doors: UnlockDoors },
    ) => listener(payload);
    ipcRenderer.on("boot:unlock-needed", handler);
    return () => ipcRenderer.removeListener("boot:unlock-needed", handler);
  },
  onReady: (
    listener: (payload: { degraded?: DegradedCustody }) => void,
  ): (() => void) => {
    const handler = (
      _event: unknown,
      payload?: { degraded?: DegradedCustody },
    ) => listener(payload ?? {});
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
