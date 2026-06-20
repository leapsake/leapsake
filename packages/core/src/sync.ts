import type { SyncRow } from "@leapsake/schema";
import type { KeyStore } from "@leapsake/crypto";
import {
  type SqliteDriver,
  type SyncEngine,
  type SyncableRepo,
  createAccountRepo,
  createContactMethodsRepo,
  createContentCipher,
  createDismissalsRepo,
  createHttpSyncTransport,
  createMilestonesRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createSyncEngine,
  createSyncStateRepo,
  createTagsRepo,
} from "@leapsake/data";
import {
  type AccountBootstrap,
  type KeySession,
  joinAccount,
} from "./key-session.js";

/**
 * Build the **canonical sync allowlist** — every `SyncableRepo` that may leave
 * the device — over a driver and the unlocked master key. This is the single
 * production home for "what syncs": adding an entity is one more entry here, and
 * the device-local key tables (`content_key`/`key_wrap`/`sync_state`/`account`/
 * `device`) are *absent by construction*, which is what keeps sync
 * zero-knowledge (model.md §3). A guard test pins this exact set.
 *
 * `milestones` takes a {@link createContentCipher} so its encrypted `note`
 * decrypts on collect and re-seals under the receiving device's own content key
 * on apply (the device-local-key invariant); every other repo is plaintext-row.
 */
export function syncableRepos(
  driver: SqliteDriver,
  masterKey: Uint8Array,
): SyncableRepo<SyncRow>[] {
  const cipher = createContentCipher({ driver, masterKey });
  const tags = createTagsRepo(driver);
  const contactMethods = createContactMethodsRepo(driver);
  return [
    createPeopleRepo(driver),
    createPetsRepo(driver),
    createMilestonesRepo(driver, cipher),
    createRelationshipsRepo(driver),
    createDismissalsRepo(driver),
    tags,
    tags.taggings,
    contactMethods.emails,
    contactMethods.phones,
    contactMethods.postals,
  ];
}

/**
 * Assemble the production {@link SyncEngine} for an account: the full
 * {@link syncableRepos} allowlist, durable {@link createSyncStateRepo}
 * watermarks, and the authenticated blind-relay HTTP transport. The engine
 * consumes the transport unchanged — same port as the in-memory test adapter —
 * so this helper only wires the pieces the apps would otherwise hand-roll.
 */
export function createAccountSyncEngine(opts: {
  driver: SqliteDriver;
  masterKey: Uint8Array;
  relayUrl: string;
  accountId: string;
  authVerifier: Uint8Array;
}): SyncEngine {
  const { driver, masterKey, relayUrl, accountId, authVerifier } = opts;
  const transport = createHttpSyncTransport({
    baseUrl: relayUrl,
    accountId,
    authVerifier,
  });
  return createSyncEngine({
    transport,
    masterKey,
    repos: syncableRepos(driver, masterKey),
    syncState: createSyncStateRepo(driver),
  });
}

/**
 * Prelogin existence probe for the combined sign-up / log-in flow: does this
 * username already have an account on the relay? Drives the identity-first UI —
 * a miss offers "create an account", a hit routes to log in. Uses the same
 * unauthenticated `lookup` a joining device runs (it must fetch the public salt
 * before it can derive anything, model.md §9.3), so this exposes nothing the
 * relay didn't already answer; enumeration defense stays a relay concern
 * (rate-limiting / the registration-token seam, security-review.md).
 *
 * Returns `true` on a hit, `false` on the relay's 404 miss. A connection failure
 * (relay unreachable) or any other status propagates, so the caller can tell
 * "no such account" apart from "couldn't reach the relay".
 */
export async function lookupAccount(opts: {
  relayUrl: string;
  username: string;
  fetch?: typeof fetch;
}): Promise<boolean> {
  const transport = createHttpSyncTransport({
    baseUrl: opts.relayUrl,
    fetch: opts.fetch,
  });
  try {
    await transport.lookup(opts.username);
    return true;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // The relay answers an unknown username with 404; anything else (a
    // connection failure, an unexpected status) is a real error to surface.
    if (message.includes("404")) return false;
    throw cause;
  }
}

/**
 * Register a freshly-enabled account with its relay so a second device can later
 * log in: upload the public salt, unique username, and the *ciphertext*
 * `wrap(MK, KEK)` (the relay reads none of it, multi-device-login.md). Builds the
 * authenticated transport from the {@link AccountBootstrap} {@link enableSync}
 * returned, keeping the HTTP transport out of the app layer. A duplicate username
 * surfaces as the relay's 409 → a thrown error.
 */
export async function registerAccountWithRelay(opts: {
  relayUrl: string;
  bootstrap: AccountBootstrap;
}): Promise<void> {
  const { relayUrl, bootstrap } = opts;
  if (bootstrap.username === null) {
    throw new Error("A username is required to register with a relay.");
  }
  const transport = createHttpSyncTransport({
    baseUrl: relayUrl,
    accountId: bootstrap.accountId,
    authVerifier: bootstrap.authVerifier,
  });
  await transport.register({
    username: bootstrap.username,
    kdfSalt: bootstrap.kdfSalt,
    wrappedMasterKey: bootstrap.wrappedMasterKey,
  });
}

/**
 * Join an existing account from a fresh device via the relay (custody Phase 2):
 * build the credential-less bootstrap transport and run {@link joinAccount},
 * which preloads, unwraps the master key, and adopts it under this device's
 * enclave. Returns the unlocked {@link KeySession} so the caller rebuilds `core`.
 * Keeps the HTTP transport construction in core; the app passes only coordinates.
 */
export function joinAccountViaRelay(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  relayUrl: string;
  username: string;
  password: string;
  label?: string;
  platform?: string;
}): Promise<KeySession> {
  const { relayUrl, ...rest } = opts;
  const transport = createHttpSyncTransport({ baseUrl: relayUrl });
  return joinAccount({ ...rest, relayUrl, transport });
}

/**
 * Run one push→pull cycle for the enabled account on this store. Reads the
 * account singleton and its relay coordinates (`relayUrl`/`authVerifier`)
 * internally so an IPC handler stays one line. Returns the completion time for a
 * "last synced" indicator. Throws if sync is not enabled, or the account is not
 * relay-bound (no `relayUrl`) — enable-sync with a relay must precede a sync.
 */
export async function runAccountSync(opts: {
  driver: SqliteDriver;
  masterKey: Uint8Array;
}): Promise<{ at: number }> {
  const { driver, masterKey } = opts;
  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined) {
    throw new Error("Sync is not enabled for this store.");
  }
  if (account.relayUrl === null) {
    throw new Error("This account is not connected to a relay.");
  }
  const engine = createAccountSyncEngine({
    driver,
    masterKey,
    relayUrl: account.relayUrl,
    accountId: account.id,
    authVerifier: account.authVerifier,
  });
  await engine.sync();
  return { at: Date.now() };
}
