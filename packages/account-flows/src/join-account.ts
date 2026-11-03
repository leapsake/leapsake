import { ensureDatabaseKey } from "@leapsake/crypto";
import { MIN_PASSWORD_LENGTH, getSyncStatus } from "@leapsake/key-custody";
import {
  type PasswordDoorWriter,
  joinAccountViaRelay,
  recoverAccountViaRelay,
} from "@leapsake/sync";
import { adoptStore } from "./adopt-store.js";
import type { AccountFlowPorts } from "./ports.js";
import { overRelay } from "./relay-error.js";

/** Join an account on a relay from this accountless device, with its
 *  password. */
export function joinAccount(
  ports: AccountFlowPorts,
  opts: { relayUrl: string; username: string; password: string },
): Promise<{ accountId: string }> {
  return adoptFromRelay(ports, opts.username, (writePasswordSidecar) =>
    joinAccountViaRelay({
      ...opts,
      keyStore: ports.keyStore,
      driver: ports.driver,
      platform: ports.platform,
      writePasswordSidecar,
    }),
  );
}

/** Recover an account on a relay onto this accountless device, with its
 *  recovery phrase, setting a new password. */
export function recoverAccount(
  ports: AccountFlowPorts,
  opts: {
    relayUrl: string;
    username: string;
    recoveryPhrase: string;
    newPassword: string;
  },
): Promise<{ accountId: string }> {
  if (opts.newPassword.length < MIN_PASSWORD_LENGTH) {
    return Promise.reject(
      new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`),
    );
  }
  return adoptFromRelay(ports, opts.username, (writePasswordSidecar) =>
    recoverAccountViaRelay({
      ...opts,
      keyStore: ports.keyStore,
      driver: ports.driver,
      platform: ports.platform,
      writePasswordSidecar,
    }),
  );
}

/**
 * Adopt the account's master key over the relay, then convert this store
 * before the first pull, so no account data ever reaches a plaintext file.
 */
async function adoptFromRelay(
  ports: AccountFlowPorts,
  username: string,
  adopt: (writePasswordSidecar: PasswordDoorWriter) => Promise<unknown>,
): Promise<{ accountId: string }> {
  const { keyStore, driver, custody } = ports;

  if (custody !== "plaintext") {
    throw new Error(
      "This device already holds an account. Forget it before joining another.",
    );
  }

  // First, since the adoption seals a password door only once a db-key exists.
  const dbKey = await ensureDatabaseKey(keyStore);

  // Captured, not written: the account's slot does not exist until adoption.
  let passwordDoor: Uint8Array | undefined;
  await overRelay(() =>
    adopt(async (door) => {
      passwordDoor = door;
    }),
  );
  if (passwordDoor === undefined) {
    throw new Error(
      "Joining did not seal this device's password door; refusing to convert the store.",
    );
  }

  const status = await getSyncStatus({ driver });
  if (status.accountId === undefined) {
    throw new Error("Joining did not record an account on this store.");
  }

  await adoptStore(ports, {
    accountId: status.accountId,
    username: status.username ?? username,
    dbKey,
    passwordDoor,
  });
  return { accountId: status.accountId };
}
