import {
  RECOVERY_KEY,
  createInMemoryKeyStore,
  deriveRecoveryVerifier,
  unwrapKey,
} from "@leapsake/crypto";
import {
  type AccountBootstrap,
  type SqliteDriver,
  bindRelayToAccount,
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
  runMigrations,
} from "@leapsake/core";
import { createKeyWrapRepo } from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";
import { equalBytes } from "../support/fake-relay.js";

/**
 * **Binding a relay to an account that already exists**
 * (`encryption/model.md` §7.2.2) — the act that makes
 * `model.md` §7.2's *"start syncing later adds a relay binding rather than a new
 * ritual"* true, and the only place a **409** is reachable by anything other than
 * a race.
 *
 * The two properties worth the most are at the ends of this file: that binding
 * publishes the account **unchanged** (same master key, same phrase, no new
 * ritual), and that a taken username leaves the user exactly where they were, free
 * to retry under another handle. Everything between is the guard rail.
 */
const RELAY = "https://relay.example";
const PASSWORD = "correct-horse-battery";

let keyStore: ReturnType<typeof createInMemoryKeyStore>;
let driver: SqliteDriver;
let cleanup: () => void;

beforeEach(async () => {
  keyStore = createInMemoryKeyStore();
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
});
afterEach(() => cleanup());

/**
 * The state this whole increment is about: an account created **locally**, with a
 * username the user picked with no relay in sight, and no relay binding. Returns
 * what `enableSync` minted, so the cases can prove binding did not change it.
 */
async function localOnlyAccount(username = "ada") {
  const { account, recoveryKey } = await enableSync({
    keyStore,
    driver,
    username,
    password: PASSWORD,
    platform: "desktop",
  });
  return { account, recoveryKey };
}

/** Capture what would be published, and accept it. */
function acceptingRelay(): {
  register: (bootstrap: AccountBootstrap) => Promise<void>;
  published: () => AccountBootstrap;
} {
  let seen: AccountBootstrap | undefined;
  return {
    register: async (bootstrap) => {
      seen = bootstrap;
    },
    published: () => {
      if (seen === undefined) throw new Error("nothing was published");
      return seen;
    },
  };
}

/** The relay answering 409 — `HttpSyncTransport` surfaces it as this throw. */
const usernameTaken = () =>
  Promise.reject(new Error("relay POST /accounts failed: 409"));

describe("binding a relay to an existing local account", () => {
  it("publishes the account's own keys, minting nothing", async () => {
    const { account, recoveryKey } = await localOnlyAccount();
    const masterKeyBefore = await masterKeyOf(driver, keyStore);
    const relay = acceptingRelay();

    await bindRelayToAccount({
      keyStore,
      driver,
      username: "ada",
      relayUrl: RELAY,
      registerWithRelay: relay.register,
    });

    const published = relay.published();
    // The account identity the relay is told about is the one that already
    // existed — binding publishes, it does not re-establish.
    expect(published.accountId).toBe(account.id);
    expect(equalBytes(published.kdfSalt, account.kdfSalt)).toBe(true);
    expect(equalBytes(published.authVerifier, account.authVerifier)).toBe(true);

    // The two escrow values are the only things computed here, and both must be
    // *this* account's — a joining device unwraps the first to reveal the same 24
    // words the user already wrote down, and the relay authenticates a recovery
    // against the second.
    expect(
      equalBytes(
        unwrapKey(published.wrappedRecoveryKey, masterKeyBefore),
        recoveryKey,
      ),
    ).toBe(true);
    expect(
      equalBytes(
        published.recoveryVerifier,
        deriveRecoveryVerifier(recoveryKey),
      ),
    ).toBe(true);

    // And nothing local was re-minted: the master key is the same one, so no
    // peer's ciphertext and no existing door is affected.
    expect(
      equalBytes(await masterKeyOf(driver, keyStore), masterKeyBefore),
    ).toBe(true);
    expect(
      equalBytes((await keyStore.getSecret(RECOVERY_KEY))!, recoveryKey),
    ).toBe(true);
  });

  it("publishes the stored password door, so another device can log in", async () => {
    await localOnlyAccount();
    const relay = acceptingRelay();
    const storedWrap = await passwordWrapOf(driver);

    await bindRelayToAccount({
      keyStore,
      driver,
      username: "ada",
      relayUrl: RELAY,
      registerWithRelay: relay.register,
    });

    // Not a fresh wrapping under a re-derived KEK — the row `enableSync` wrote at
    // account creation, which is why binding needs no password.
    expect(equalBytes(relay.published().wrappedMasterKey, storedWrap)).toBe(
      true,
    );
  });

  it("records the binding locally, so the store now reports a relay", async () => {
    await localOnlyAccount();
    expect((await getSyncStatus({ driver })).relayUrl).toBeUndefined();

    await bindRelayToAccount({
      keyStore,
      driver,
      username: "ada",
      relayUrl: RELAY,
      registerWithRelay: acceptingRelay().register,
    });

    const status = await getSyncStatus({ driver });
    expect(status.relayUrl).toBe(RELAY);
    expect(status.username).toBe("ada");
  });

  it("normalizes the username the way the relay does", async () => {
    await localOnlyAccount();
    const relay = acceptingRelay();

    await bindRelayToAccount({
      keyStore,
      driver,
      username: "  AdA  ",
      relayUrl: RELAY,
      registerWithRelay: relay.register,
    });

    // Both halves, or the client and the relay disagree about which names collide.
    expect(relay.published().username).toBe("ada");
    expect((await getSyncStatus({ driver })).username).toBe("ada");
  });

  /**
   * **The increment's reason for existing.** A locally-chosen username may already
   * belong to someone else, and the user who hits that must be left holding the
   * working local-only account they started with — free to retry under another
   * handle, or to merge instead.
   */
  it("leaves the account untouched when the username is taken", async () => {
    const { account } = await localOnlyAccount();

    await expect(
      bindRelayToAccount({
        keyStore,
        driver,
        username: "ada",
        relayUrl: RELAY,
        registerWithRelay: usernameTaken,
      }),
    ).rejects.toThrow(/409/);

    // Still local-only, still theirs, still under the name they chose. Had this
    // persisted before publishing, the next sync would 401 forever.
    const status = await getSyncStatus({ driver });
    expect(status.accountId).toBe(account.id);
    expect(status.relayUrl).toBeUndefined();
    expect(status.username).toBe("ada");
  });

  // The rename half of the 409 fork: there is no rename primitive because the
  // handle was never published, so picking another one is simply a second attempt.
  it("binds under a different username after a collision", async () => {
    const { account } = await localOnlyAccount();
    await expect(
      bindRelayToAccount({
        keyStore,
        driver,
        username: "ada",
        relayUrl: RELAY,
        registerWithRelay: usernameTaken,
      }),
    ).rejects.toThrow(/409/);

    const relay = acceptingRelay();
    const { accountId } = await bindRelayToAccount({
      keyStore,
      driver,
      username: "ada-lovelace",
      relayUrl: RELAY,
      registerWithRelay: relay.register,
    });

    // The same account, published under a handle it can actually have.
    expect(accountId).toBe(account.id);
    expect(relay.published().username).toBe("ada-lovelace");
    expect((await getSyncStatus({ driver })).username).toBe("ada-lovelace");
  });

  it("refuses an account that is already bound", async () => {
    await localOnlyAccount();
    await bindRelayToAccount({
      keyStore,
      driver,
      username: "ada",
      relayUrl: RELAY,
      registerWithRelay: acceptingRelay().register,
    });

    // Re-binding is a rename on the relay's namespace, which this does not do.
    await expect(
      bindRelayToAccount({
        keyStore,
        driver,
        username: "ada-again",
        relayUrl: RELAY,
        registerWithRelay: acceptingRelay().register,
      }),
    ).rejects.toThrow(/already syncing/);
  });

  it("refuses a store with no account", async () => {
    await expect(
      bindRelayToAccount({
        keyStore,
        driver,
        username: "ada",
        relayUrl: RELAY,
        registerWithRelay: acceptingRelay().register,
      }),
    ).rejects.toThrow(/no account on this device/);
  });

  it("requires a username", async () => {
    await localOnlyAccount();
    await expect(
      bindRelayToAccount({
        keyStore,
        driver,
        username: "   ",
        relayUrl: RELAY,
        registerWithRelay: acceptingRelay().register,
      }),
    ).rejects.toThrow(/username is required/);
  });

  /**
   * A device that came back through a *password* door no longer holds the
   * account's recovery key (`model.md` §6) — it stayed in the enclave that was
   * wiped. Minting a replacement here would escrow a phrase nobody has written
   * down, silently invalidating the 24 words the user did write down, so this
   * refuses and names the way out.
   */
  it("refuses a device that no longer holds the recovery key, and says how to fix it", async () => {
    await localOnlyAccount();
    await keyStore.deleteSecret(RECOVERY_KEY);

    let published = false;
    await expect(
      bindRelayToAccount({
        keyStore,
        driver,
        username: "ada",
        relayUrl: RELAY,
        registerWithRelay: async () => {
          published = true;
        },
      }),
    ).rejects.toThrow(/Replace your recovery phrase/);

    // Refused before the relay heard anything, so nothing is half-published.
    expect(published).toBe(false);
    expect((await getSyncStatus({ driver })).relayUrl).toBeUndefined();
  });
});

/** This device's master key, unwrapped from its enclave row the way the boot does. */
async function masterKeyOf(
  driver: SqliteDriver,
  keyStore: ReturnType<typeof createInMemoryKeyStore>,
): Promise<Uint8Array> {
  const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
  return masterKey;
}

/** The `wrap(MK, password-KEK)` row `enableSync` persisted at account creation. */
async function passwordWrapOf(driver: SqliteDriver): Promise<Uint8Array> {
  const wrap = await createKeyWrapRepo(driver).getActive({
    wrappedKind: "master",
    principalKind: "password",
  });
  if (wrap === undefined) throw new Error("no password wrap");
  return wrap.ciphertext;
}
