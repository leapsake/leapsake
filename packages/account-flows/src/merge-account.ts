import { type KeyStore, ensureDatabaseKey } from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/data";
import {
  KEYSTORE_SECRET_IDS,
  clearLocalAccount,
  getSyncStatus,
} from "@leapsake/key-custody";
import { joinAccountViaRelay, lookupAccountId } from "@leapsake/sync";
import type { AccountFlowPorts } from "./ports.js";
import { overRelay } from "./relay-error.js";

/** Move this device's local-only account into an account on a relay,
 *  keeping every row; the README's _Merging_ says why it works on a copy. */
export async function mergeIntoAccount(
  ports: AccountFlowPorts,
  opts: { relayUrl: string; username: string; password: string },
): Promise<{ accountId: string }> {
  const { keyStore, driver, custody, roster, files, platform } = ports;
  const { relayUrl, username, password } = opts;

  const local = await getSyncStatus({ driver });
  if (!local.hasAccount || local.accountId === undefined) {
    throw new Error("This device has no account to merge.");
  }
  if (local.relayUrl !== undefined) {
    throw new Error("This device's account already syncs through a relay.");
  }
  const localId = local.accountId;
  if (custody !== "encrypted") {
    throw new Error("This device's store is not encrypted.");
  }
  if (!(await roster.list()).some((a) => a.id === localId)) {
    throw new Error("This device's account is not in its roster.");
  }

  // Read, not minted. The copy keeps it: the key is the device's, not the
  // account's.
  const dbKey = await ensureDatabaseKey(keyStore);

  // Before closing the store: the network is the part likely to fail.
  const { accountId: syncedId } = await overRelay(() =>
    lookupAccountId({ relayUrl, username }),
  );
  if (
    syncedId === localId ||
    (await roster.list()).some((a) => a.id === syncedId)
  ) {
    throw new Error("This device already holds that account.");
  }

  await files.close();
  await files.removeAccountStore(syncedId);
  await files.copyAccountStore(localId, syncedId, dbKey);

  const keychainBefore = await snapshot(keyStore, KEYSTORE_SECRET_IDS);
  let joinedUsername: string | undefined;
  try {
    const copy = await files.openAccountStore(syncedId, dbKey);
    let passwordDoor: Uint8Array | undefined;
    try {
      // Joining refuses a store that still holds an account row.
      await clearLocalAccount({ driver: copy });
      await overRelay(() =>
        joinAccountViaRelay({
          keyStore,
          driver: copy,
          relayUrl,
          username,
          password,
          platform,
          writePasswordSidecar: async (door) => {
            passwordDoor = door;
          },
        }),
      );
      joinedUsername = await checkJoined(copy, syncedId);
    } finally {
      await copy.close?.();
    }
    if (passwordDoor === undefined) {
      throw new Error(
        "Logging in did not seal this device's password door; refusing to finish the merge.",
      );
    }
    await files.writePasswordDoor(syncedId, passwordDoor);
  } catch (cause) {
    // The keychain is outside the copy; left changed, re-opening the local
    // store would re-seal its phrase door under the account's recovery key.
    await keychainBefore.restore();
    try {
      await files.removeAccountStore(syncedId);
    } catch {
      // The original failure is the one worth reporting.
    }
    throw cause;
  }

  // One write, and the point of no return: before it nothing had happened.
  await roster.replace(localId, {
    id: syncedId,
    username: joinedUsername ?? username,
    createdAt: new Date().toISOString(),
  });

  try {
    await files.removeAccountStore(localId);
  } catch {
    // Inert ciphertext no roster entry names; nothing reads it.
  }
  return { accountId: syncedId };
}

/** The copy's account after the join, refusing one that is not `syncedId`. */
async function checkJoined(
  copy: SqliteDriver,
  syncedId: string,
): Promise<string | undefined> {
  const joined = await getSyncStatus({ driver: copy });
  if (joined.accountId !== syncedId) {
    throw new Error(
      "Logging in landed on a different account than this store was moved to.",
    );
  }
  return joined.username;
}

/** The current value of each secret, and a way to put them all back. */
async function snapshot(keyStore: KeyStore, ids: readonly string[]) {
  const values = new Map<string, Uint8Array | undefined>();
  for (const id of ids) values.set(id, await keyStore.getSecret(id));
  return {
    async restore() {
      for (const [id, value] of values) {
        if (value === undefined) await keyStore.deleteSecret(id);
        else await keyStore.setSecret(id, value);
      }
    },
  };
}
