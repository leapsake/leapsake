import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KeyStore } from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/core";
import {
  type AccountBootstrap,
  clearLocalAccount,
  createLocalAccount,
} from "@leapsake/core";
import {
  type AccountRoster,
  OPEN_STORE_SLOT,
  storePath,
} from "@leapsake/store-layout";
import {
  convertStoreToEncrypted,
  destroyPlaintextStore,
} from "./convert-store.js";
import { storeFileState } from "./sqlite-header.js";

/**
 * **Account creation, end to end** (`model.md` §7.2.1) — the single act that turns
 * encryption on. Mints every key, converts the Open store to Protected, records
 * the account in the roster, and destroys the plaintext original.
 *
 * The step order is chosen so that a crash at *any* point leaves a launchable
 * device (see {@link convertStoreToEncrypted} for the table). In short: the
 * plaintext original outlives the conversion, and dies only once the roster points
 * at its replacement.
 *
 * The caller closes the store's driver before calling and reopens afterwards — the
 * file cannot be converted while a handle is writing to it, and the new store is
 * opened by the ordinary Protected boot path, which also writes the recovery
 * sidecar as it does on every launch.
 */
export async function createAccountOnThisDevice(opts: {
  keyStore: KeyStore;
  /** The open **plaintext** store; account rows are written into it first. */
  driver: SqliteDriver;
  roster: AccountRoster;
  userDataPath: string;
  username: string;
  password: string;
  /** Set when this act also binds a relay (§7.5 Phase 1). */
  relayUrl?: string;
  /**
   * Publish the account to its relay. Called **before** the store is converted,
   * so a rejected registration (a taken username, an unreachable relay) rolls the
   * account back and leaves the device exactly as it was — still Open, still
   * plaintext, nothing to undo on disk.
   */
  registerWithRelay?: (bootstrap: AccountBootstrap) => Promise<void>;
  /** Close the store's handle; the conversion needs the file quiescent. */
  closeStore: () => Promise<void>;
}): Promise<{ accountId: string; recoveryPhrase: string; storePath: string }> {
  const { keyStore, driver, roster, userDataPath, username, password } = opts;

  const openPath = join(userDataPath, storePath(OPEN_STORE_SLOT));
  if (storeFileState(openPath) !== "plaintext") {
    throw new Error(
      "An account can only be created from an unencrypted store on this device.",
    );
  }

  // 1. Keys + account rows, written into the store while it is still plaintext —
  //    the conversion copies whatever is there, so these must precede it.
  const { accountId, recoveryPhrase, dbKey, bootstrap } =
    await createLocalAccount({
      keyStore,
      driver,
      username,
      password,
      relayUrl: opts.relayUrl,
      platform: "desktop",
    });

  // 1b. Bind the relay, if this act is doing that too. Before the conversion on
  //     purpose: it is the step most likely to fail, and failing here costs
  //     nothing irreversible.
  if (opts.registerWithRelay !== undefined) {
    try {
      await opts.registerWithRelay(bootstrap);
    } catch (cause) {
      await clearLocalAccount({ driver });
      throw cause;
    }
  }

  const encryptedPath = join(userDataPath, storePath(accountId));
  await opts.closeStore();

  // A destination left by an earlier attempt that crashed before its roster entry
  // is claimed by nobody, so it is discardable — and clearing it is what lets a
  // retry succeed rather than trip the conversion's overwrite guard.
  if (
    storeFileState(encryptedPath) !== "absent" &&
    !(await roster.list()).some((a) => a.id === accountId)
  ) {
    rmSync(dirname(encryptedPath), { recursive: true, force: true });
  }

  // 2. Convert. The original survives this on purpose.
  convertStoreToEncrypted({
    fromPath: openPath,
    toPath: encryptedPath,
    key: dbKey,
  });

  // 3. Point the roster at the new store. Past this line the device is Protected.
  await roster.add({
    id: accountId,
    username,
    createdAt: new Date().toISOString(),
  });

  // 4. Only now destroy the plaintext original.
  destroyPlaintextStore(openPath);
  rmSync(dirname(openPath), { recursive: true, force: true });

  return { accountId, recoveryPhrase, storePath: encryptedPath };
}
