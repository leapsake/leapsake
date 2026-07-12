import type { SyncRow } from "@leapsake/schema";
import { type KeyStore, decodeRecoveryPhrase } from "@leapsake/crypto";
import {
  type DuplicateCandidate,
  type SqliteDriver,
  type SyncEngine,
  type SyncableRepo,
  createAccountRepo,
  createContactMethodsRepo,
  createContentCipher,
  createDismissalsRepo,
  createHttpSyncTransport,
  createMilestonesRepo,
  createNotADuplicateRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createRemindersRepo,
  createSyncEngine,
  createSyncStateRepo,
  createTagsRepo,
} from "@leapsake/data";
import {
  type AccountBootstrap,
  type KeySession,
  joinAccount,
  reauthenticate,
  recoverAccount,
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
    createNotADuplicateRepo(driver),
    createRemindersRepo(driver),
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
    wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
    recoveryVerifier: bootstrap.recoveryVerifier,
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
 * Recover an account on a fresh device from the **recovery phrase** via the relay
 * (the "forgot password" path, `model.md` §6): decode the phrase to the recovery
 * key here (so a bad phrase fails fast, before any network call, with a friendly
 * message), build the credential-less recovery transport, and run
 * {@link recoverAccount} — which unwraps MK from the relay's recovery escrow,
 * resets the password, and adopts MK + the recovery key on this device. Returns
 * the unlocked {@link KeySession} so the caller rebuilds `core`.
 */
export function recoverAccountViaRelay(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  relayUrl: string;
  username: string;
  recoveryPhrase: string;
  newPassword: string;
  label?: string;
  platform?: string;
}): Promise<KeySession> {
  const { relayUrl, recoveryPhrase, ...rest } = opts;
  const recoveryKey = decodeRecoveryPhrase(recoveryPhrase);
  const transport = createHttpSyncTransport({ baseUrl: relayUrl });
  return recoverAccount({ ...rest, relayUrl, recoveryKey, transport });
}

/**
 * Run one push→pull cycle for the enabled account on this store. Reads the
 * account singleton and its relay coordinates (`relayUrl`/`authVerifier`)
 * internally so an IPC handler stays one line. Returns the completion time for a
 * "last synced" indicator, plus `applied` — the number of records the pull
 * delivered, so a caller can revalidate the UI only when a pull changed
 * something. Throws if sync is not enabled, or the account is not relay-bound
 * (no `relayUrl`) — enable-sync with a relay must precede a sync.
 */
export async function runAccountSync(opts: {
  driver: SqliteDriver;
  masterKey: Uint8Array;
}): Promise<{ at: number; applied: number }> {
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
  const { applied } = await engine.sync();
  return { at: Date.now(), applied };
}

/**
 * Re-authenticate the enabled account on this store after another device reset the
 * password (the relay 401 follow-up, `status.md`): read the account's relay
 * coordinates internally (like {@link runAccountSync}), build the credential-less
 * bootstrap transport, and run {@link reauthenticate} with the re-entered password.
 * Throws if sync is not enabled or the account is not relay-bound. Keeps the HTTP
 * transport construction in core; the app passes only the new password.
 */
export async function reauthenticateViaRelay(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
}): Promise<void> {
  const { keyStore, driver, password } = opts;
  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined) {
    throw new Error("Sync is not enabled for this store.");
  }
  if (account.relayUrl === null) {
    throw new Error("This account is not connected to a relay.");
  }
  const transport = createHttpSyncTransport({ baseUrl: account.relayUrl });
  await reauthenticate({ keyStore, driver, transport, password });
}

/**
 * Whether a sync failure is the relay rejecting this device's credential (a 401) —
 * the signal that the password was reset elsewhere and the device should prompt to
 * re-authenticate (`reauthenticateViaRelay`). The HTTP transport surfaces relay
 * failures as `"relay <method> /<path> failed: <status>"`, so a substring check is
 * the seam both the scheduler's error path and the clients agree on.
 */
export function isRelayAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("401");
}

export interface JoinReconcileResult {
  /**
   * How many possible duplicates the join surfaced between this device's
   * pre-existing people and the account's — what the client prompts the user to
   * review. `0` means nothing to review (a fresh device, or no overlap).
   */
  duplicateCount: number;
}

/**
 * Pure: the candidate pairs the join *introduced* — exactly one side is a
 * pre-existing **local** person (the other came from the account). Pre-existing
 * local↔local and account↔account pairs are excluded, so the count reflects only
 * what joining surfaced, not duplicates the user already lived with.
 */
export function selectJoinDuplicates(
  candidates: DuplicateCandidate[],
  localIds: ReadonlySet<string>,
): DuplicateCandidate[] {
  return candidates.filter(
    (c) => localIds.has(c.a.id) !== localIds.has(c.b.id),
  );
}

/**
 * Reconcile a device's pre-existing local data against the account it just
 * joined. Pulls the account's records first so its people/contacts are local,
 * then reports how many possible duplicates straddle the local/account boundary
 * — so the client can prompt the user to **review** them. By design it does
 * **not** auto-merge (a wrong merge is destructive) and does **not** push: the
 * local people are real user data, preserved and pushed up by the normal
 * post-join sync; merging is manual via the existing duplicate-review surface.
 *
 * Returns `{ duplicateCount: 0 }` for a fresh device (no local people) or an
 * account with no relay, skipping the pull entirely.
 */
export async function reconcileOnJoin(opts: {
  driver: SqliteDriver;
  masterKey: Uint8Array;
  core: { duplicates: { findCandidates(): Promise<DuplicateCandidate[]> } };
}): Promise<JoinReconcileResult> {
  const { driver, masterKey, core } = opts;

  // Snapshot local people BEFORE the pull → exactly the pre-existing set.
  const localIds = new Set(
    (await createPeopleRepo(driver).list()).map((p) => p.id),
  );
  if (localIds.size === 0) return { duplicateCount: 0 };

  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined || account.relayUrl === null) {
    return { duplicateCount: 0 };
  }

  // Pull-first: bring the account's people/contacts local so detection sees both
  // sets. Persist the cursor so the following autoTrigger sync() doesn't re-pull.
  const engine = createAccountSyncEngine({
    driver,
    masterKey,
    relayUrl: account.relayUrl,
    accountId: account.id,
    authVerifier: account.authVerifier,
  });
  const syncState = createSyncStateRepo(driver);
  const { cursor } = await engine.pull(await syncState.getPullCursor());
  await syncState.setPullCursor(cursor);

  const candidates = await core.duplicates.findCandidates();
  return { duplicateCount: selectJoinDuplicates(candidates, localIds).length };
}

/**
 * Read this install's "Sync automatically" preference (default `true`). It is a
 * per-client/per-device setting held in the device-local `sync_state` table — it
 * never replicates — so a client reads it at bootstrap to initialize the
 * scheduler and again when rendering the Settings toggle.
 */
export function getAutoSync(opts: { driver: SqliteDriver }): Promise<boolean> {
  return createSyncStateRepo(opts.driver).getAutoSyncEnabled();
}

/**
 * Persist this install's "Sync automatically" preference. The caller is also
 * responsible for telling the live scheduler (`setAutoEnabled`) so the change
 * takes effect immediately; this only makes it durable across restarts.
 */
export function setAutoSync(opts: {
  driver: SqliteDriver;
  enabled: boolean;
}): Promise<void> {
  return createSyncStateRepo(opts.driver).setAutoSyncEnabled(opts.enabled);
}
