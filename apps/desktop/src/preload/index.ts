import type { CoreApi, GenderResult, SyncStatus } from "@leapsake/core";
import { contextBridge, ipcRenderer } from "electron";
import { API_CHANNELS } from "../shared/api-channels.js";
import { buildBridgeApi } from "../shared/ipc-bridge.js";

/**
 * `window.api`: thin `ipcRenderer.invoke` wrappers generated from the shared
 * channel manifest, so the bridge cannot drift from {@link CoreApi}.
 */
const api: CoreApi = buildBridgeApi(API_CHANNELS, (channel, args) =>
  ipcRenderer.invoke(channel, ...args),
);

contextBridge.exposeInMainWorld("api", api);

/** `window.account`: custody operations outside {@link CoreApi}. */
const account = {
  status: (): Promise<SyncStatus> => ipcRenderer.invoke("account:status"),
  /** Resolves with the recovery phrase once the converted store is open. */
  createAccount: (args: {
    username: string;
    password: string;
  }): Promise<{ accountId: string; recoveryPhrase: string }> =>
    ipcRenderer.invoke("account:create", args),
  /**
   * Don't await: it settles only after the user passes the unlock gate, and
   * `window.boot.onUnlockNeeded` fires first.
   */
  signOut: (): Promise<void> => ipcRenderer.invoke("account:signOut"),
  /** `durableBackup` is false unless the relay says it keeps a copy. */
  forgetInfo: (): Promise<{
    username?: string;
    durableBackup: boolean;
  }> => ipcRenderer.invoke("account:forgetInfo"),
  /** The main process reloads the renderer; there is no done state. */
  forgetAccount: (): Promise<void> => ipcRenderer.invoke("account:forget"),
  /** Unrecoverable; the main process reloads the renderer when it is done. */
  factoryReset: (): Promise<void> => ipcRenderer.invoke("app:factoryReset"),
  /** Gated on the password; the new phrase is shown once. */
  rotateRecoveryPhrase: (
    password: string,
  ): Promise<{ recoveryPhrase: string }> =>
    ipcRenderer.invoke("account:rotateRecoveryPhrase", { password }),
};

contextBridge.exposeInMainWorld("account", account);

export type Account = typeof account;

/** Which doors the store being unlocked actually offers. */
export interface UnlockDoors {
  password: boolean;
  phrase: boolean;
}

/** Why this device cannot prove which master key is the account's. */
interface DegradedCustody {
  detail: string;
}

/**
 * `window.boot`: the unlock gate. `status` is the race-safe first read; a
 * Degraded store is still `ready`, and the renderer keeps a banner up.
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

/** Fires when the main process changes rows on its own, e.g. birthdays. */
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

export type Api = CoreApi;
