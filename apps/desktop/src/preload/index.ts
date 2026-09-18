import type { CoreApi, GenderResult, SyncStatus } from "@leapsake/core";
import type { FlagName } from "@leapsake/flags";
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
 * This launch's feature flags (@leapsake/flags), resolved in the main process
 * and read synchronously here so `window.flags` is a plain object the renderer
 * has before its first render — a promise would put a flag-less frame on screen.
 *
 * Main is the only half that reads the environment, so a flag cannot mean one
 * thing to the scheduler and another to Settings.
 */
contextBridge.exposeInMainWorld(
  "flags",
  ipcRenderer.sendSync("flags:snapshot") as Record<FlagName, boolean>,
);

/**
 * The account custody surface, exposed as a **separate** `window.sync` bridge
 * rather than folded into `window.api`. Creating an account is not a
 * {@link CoreApi} operation — it derives a KEK in the main process and touches
 * the OS keystore — so keeping it off the generated `window.api` surface above
 * stops the IPC contract and core from drifting.
 */
const sync = {
  status: (): Promise<SyncStatus> => ipcRenderer.invoke("sync:status"),
  /**
   * Create an account on this device (@leapsake/key-custody) — the act that turns
   * encryption on. Fully local. Resolves with the 24-word recovery phrase for its
   * one-time reveal, by which point the main process has already re-opened the
   * app around the converted store — there is nothing to restart.
   */
  createAccount: (args: {
    username: string;
    password: string;
  }): Promise<{ accountId: string; recoveryPhrase: string }> =>
    ipcRenderer.invoke("account:create", args),
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
   * §7.3.1). `durableBackup` is whether anything claims to keep a copy — it is
   * `false` whenever nobody said otherwise, which is what makes forgetting the
   * last device read as the deletion it is.
   */
  forgetInfo: (): Promise<{
    username?: string;
    durableBackup: boolean;
  }> => ipcRenderer.invoke("account:forgetInfo"),
  /**
   * **Forget account** (`model.md` §7.3): remove this account, its store, and both
   * of its unlock doors from this device, leaving it in the accountless state a
   * fresh install is in. The main process reloads this renderer once the empty
   * store is open, so the caller has no completion state to render.
   */
  forgetAccount: (): Promise<void> => ipcRenderer.invoke("account:forget"),
  /**
   * Factory reset: erase all local data, keys, and the recovery sidecar, then
   * come back up in a first-run state. Unrecoverable. The main process reloads
   * this renderer once the fresh store is open, so the caller has no completion
   * state to render.
   */
  factoryReset: (): Promise<void> => ipcRenderer.invoke("app:factoryReset"),
  /**
   * Replace this device's recovery phrase, gated on the account password
   * (`model.md` §6). Returns the new phrase to show **once** — there is no way to
   * see it again.
   */
  rotateRecoveryPhrase: (
    password: string,
  ): Promise<{ recoveryPhrase: string }> =>
    ipcRenderer.invoke("sync:rotateRecoveryPhrase", { password }),
};

contextBridge.exposeInMainWorld("sync", sync);

export type Sync = typeof sync;

/** Which doors the store being unlocked actually offers (`model.md` §7.5). */
export interface UnlockDoors {
  password: boolean;
  phrase: boolean;
}

/** The *Degraded* state as the renderer needs it: why this device cannot prove
 *  which master key is the account's. */
interface DegradedCustody {
  detail: string;
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
 * opened but this device could not prove which master key is the account's
 * (`model.md` §7.5). The app is fully usable — that is the point — so the phase is
 * still `ready`, and the renderer keeps a banner up for as long as it is set.
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

/**
 * Rows the main process changed on its own, without a renderer call: today the
 * automated birthday reminders it regenerates at boot and on window focus.
 * `onChanged` returns an unsubscribe function; the renderer re-runs the active
 * route's loaders when it fires.
 */
const appEvents = {
  onChanged: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on("app:changed", handler);
    return () => ipcRenderer.removeListener("app:changed", handler);
  },
};

contextBridge.exposeInMainWorld("app", appEvents);

export type AppEvents = typeof appEvents;

export type { GenderResult };

// The renderer derives its `window.api` contract from the client-agnostic core
// surface, so the IPC bridge and core can never drift. `api` above is the
// generated `ipcRenderer.invoke` implementation of this same shape, built from
// the shared channel manifest; the `ApiChannel` exhaustiveness check keeps the
// manifest complete.
export type Api = CoreApi;
