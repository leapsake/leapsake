import {
  DATABASE_KEY,
  type KeyStore,
  createInMemoryKeyStore,
} from "@leapsake/crypto";
import {
  type AccountBootstrap,
  type AccountBootstrapChannel,
  type PasswordDoorWriter,
  type RecoveryChannel,
  type SqliteDriver,
  enableSync,
  runMigrations,
  sealPasswordDoor,
} from "@leapsake/core";
import { createKeyWrapRepo } from "@leapsake/data";
import { makeEncryptedTestDriver } from "./encrypted-test-driver.js";

/**
 * **Device 1** — an account that already exists somewhere else, plus the in-memory
 * relay channels a second device reaches it through.
 *
 * Shared rather than copied because {@link sealLikeCore} reproduces core's
 * `sealPasswordDoorIfProtected` *including its skip*, and that skip is what makes
 * the custody guards in both the adopt and merge suites meaningful. A second
 * hand-rolled copy would quietly drift from the thing it stands in for — the same
 * argument `boot-device.ts` makes for itself.
 */
export interface SyncedAccount {
  bootstrap: AccountBootstrap;
  /** The account's recovery key, as `enableSync` minted it. */
  recoveryKey: Uint8Array;
  /** `wrap(MK, recoveryKey)` — what a recovering device fetches from the relay. */
  wrappedMasterKeyRecovery: Uint8Array;
  /** The password bootstrap channel: 404 on an unknown user, 401 on a bad verifier. */
  relay(): AccountBootstrapChannel;
  /** The recovery channel, which proves possession of the phrase instead. */
  recoveryRelay(): RecoveryChannel;
  cleanup(): void;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** The relay's own username normalization, mirrored. */
const normalize = (username: string) => username.trim().toLowerCase();

export async function existingAccount(opts: {
  username: string;
  password: string;
  relayUrl: string;
}): Promise<SyncedAccount> {
  const { driver, cleanup } = makeEncryptedTestDriver();
  await runMigrations(driver);
  const enabled = await enableSync({
    keyStore: createInMemoryKeyStore(),
    driver,
    username: opts.username,
    password: opts.password,
    relayUrl: opts.relayUrl,
    platform: "desktop",
  });
  const { bootstrap, recoveryKey } = enabled;
  const wrap = await createKeyWrapRepo(driver).getActive({
    wrappedKind: "master",
    principalKind: "recovery",
  });
  const wrappedMasterKeyRecovery = wrap!.ciphertext;

  return {
    bootstrap,
    recoveryKey,
    wrappedMasterKeyRecovery,
    relay: () => ({
      async lookup(username) {
        // Normalized like the real route (`apps/server/src/relay.ts`), which
        // lower-cases and trims the query before matching. Comparing raw input
        // would make this fixture stricter than the relay and 404 on a caller
        // that has not normalized yet — which prelogin, unlike `joinAccount`,
        // has not.
        if (normalize(username) !== bootstrap.username) {
          throw new Error("404 not found");
        }
        return { accountId: bootstrap.accountId, kdfSalt: bootstrap.kdfSalt };
      },
      async fetchBootstrap({ accountId, authVerifier }) {
        if (
          accountId !== bootstrap.accountId ||
          !equalBytes(authVerifier, bootstrap.authVerifier)
        ) {
          throw new Error("401 unauthorized");
        }
        return {
          wrappedMasterKey: bootstrap.wrappedMasterKey,
          wrappedRecoveryKey: bootstrap.wrappedRecoveryKey,
        };
      },
    }),
    recoveryRelay: () => ({
      async lookup(username) {
        // Normalized like the real route (`apps/server/src/relay.ts`), which
        // lower-cases and trims the query before matching. Comparing raw input
        // would make this fixture stricter than the relay and 404 on a caller
        // that has not normalized yet — which prelogin, unlike `joinAccount`,
        // has not.
        if (normalize(username) !== bootstrap.username) {
          throw new Error("404 not found");
        }
        return { accountId: bootstrap.accountId, kdfSalt: bootstrap.kdfSalt };
      },
      async fetchRecovery() {
        return wrappedMasterKeyRecovery;
      },
      async resetCredentials() {},
    }),
    cleanup,
  };
}

/**
 * `sealPasswordDoorIfProtected` (`packages/core/src/sync.ts`), reproduced: core
 * seals this device's password door after a join/recover, and **skips while there
 * is no db-key to seal**. Keeping the skip is the point — it is what makes the
 * "the flow must mint the key first" guard cases meaningful.
 */
export async function sealLikeCore(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
  write: PasswordDoorWriter;
}): Promise<void> {
  const { keyStore, driver, password, write } = opts;
  if ((await keyStore.getSecret(DATABASE_KEY)) === undefined) return;
  await write(await sealPasswordDoor({ keyStore, driver, password }));
}
