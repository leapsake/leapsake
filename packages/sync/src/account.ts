import type { SyncRow } from "@leapsake/schema";
import {
  DATABASE_KEY,
  type KeyStore,
  decodeRecoveryPhrase,
  deriveRecoveryVerifier,
  readRecoveryKey,
  unwrapKey,
  wrapKey,
} from "@leapsake/crypto";
import {
  type DuplicateCandidate,
  type SqliteDriver,
  type SyncableRepo,
  createAccountRepo,
  createPeopleRepo,
  createSyncStateRepo,
} from "@leapsake/data";
import {
  type AccountBootstrap,
  type KeySession,
  type RecoveryDoorWriter,
  adoptRecoveryKey,
  holdsRecoveryKey,
  joinAccount,
  reauthenticate,
  recoverAccount,
  rotateRecoveryPhrase,
  sealPasswordDoor,
} from "@leapsake/key-custody";
import { type SyncEngine, createSyncEngine } from "./engine.js";
import { createHttpSyncTransport } from "./http-transport.js";

// The relay half of this file has no client caller; see the README's
// _`account.ts` is dormant, deliberately_.

/** Persists this device's password door sidecar, wherever the platform keeps
 *  it; required wherever a password is set or rotated. */
export type PasswordDoorWriter = (sidecar: Uint8Array) => Promise<void>;

/** Seals and persists the password door when the store is Authenticated; a
 *  caller mints the db-key first, so a join or recover never skips. */
async function sealPasswordDoorIfProtected(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
  write: PasswordDoorWriter;
}): Promise<void> {
  const { keyStore, driver, password, write } = opts;
  if ((await keyStore.getSecret(DATABASE_KEY)) === undefined) return;
  await write(await sealPasswordDoor({ keyStore, driver, password }));
}

/** The production {@link SyncEngine}: the caller's allowlist, durable
 *  watermarks and the authenticated relay transport. */
export function createAccountSyncEngine(opts: {
  driver: SqliteDriver;
  masterKey: Uint8Array;
  relayUrl: string;
  accountId: string;
  authVerifier: Uint8Array;
  /** What may leave the device: core's `syncableRepos`. */
  repos: SyncableRepo<SyncRow>[];
}): SyncEngine {
  const { driver, masterKey, relayUrl, accountId, authVerifier, repos } = opts;
  const transport = createHttpSyncTransport({
    baseUrl: relayUrl,
    accountId,
    authVerifier,
  });
  return createSyncEngine({
    transport,
    masterKey,
    repos,
    syncState: createSyncStateRepo(driver),
  });
}

/** Whether a username has an account on the relay: `false` only on its 404,
 *  so an unreachable relay throws rather than reads as “no”. */
export async function lookupAccount(opts: {
  relayUrl: string;
  username: string;
  fetch?: typeof fetch;
}): Promise<boolean> {
  try {
    await lookupAccountId(opts);
    return true;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // Only a 404 means “no such account”; anything else is a real error.
    if (message.includes("404")) return false;
    throw cause;
  }
}

/** {@link lookupAccount}, keeping the account id; a miss throws the 404. A
 *  merge needs the id to name its destination before any password. */
export async function lookupAccountId(opts: {
  relayUrl: string;
  username: string;
  fetch?: typeof fetch;
}): Promise<{ accountId: string }> {
  const transport = createHttpSyncTransport({
    baseUrl: opts.relayUrl,
    fetch: opts.fetch,
  });
  const { accountId } = await transport.lookup(opts.username);
  return { accountId };
}

/** Registers an enabled account's salt, username and `wrap(MK, KEK)` with the
 *  relay; a taken username throws the relay's 409. */
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
    wrappedRecoveryKey: bootstrap.wrappedRecoveryKey,
    wrappedMasterKeyRecovery: bootstrap.wrappedMasterKeyRecovery,
    recoveryVerifier: bootstrap.recoveryVerifier,
  });
}

/** Joins an account via the relay and returns the unlocked {@link KeySession};
 *  driver-scoped throughout, so a merge can point it at a copy. */
export async function joinAccountViaRelay(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  relayUrl: string;
  username: string;
  password: string;
  label?: string;
  platform?: string;
  /** This device's password door; see {@link PasswordDoorWriter}. */
  writePasswordSidecar: PasswordDoorWriter;
}): Promise<KeySession> {
  const { relayUrl, writePasswordSidecar, ...rest } = opts;
  const transport = createHttpSyncTransport({ baseUrl: relayUrl });
  const session = await joinAccount({ ...rest, relayUrl, transport });
  // This device has its own db-key, so it needs its own door.
  await sealPasswordDoorIfProtected({
    keyStore: opts.keyStore,
    driver: opts.driver,
    password: opts.password,
    write: writePasswordSidecar,
  });
  return session;
}

/** Recovers an account from its phrase via the relay, setting a new password;
 *  a bad phrase fails before any network call. */
export async function recoverAccountViaRelay(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  relayUrl: string;
  username: string;
  recoveryPhrase: string;
  newPassword: string;
  label?: string;
  platform?: string;
  /** This device's password door; see {@link PasswordDoorWriter}. */
  writePasswordSidecar: PasswordDoorWriter;
}): Promise<KeySession> {
  const { relayUrl, recoveryPhrase, writePasswordSidecar, ...rest } = opts;
  const recoveryKey = decodeRecoveryPhrase(recoveryPhrase);
  const transport = createHttpSyncTransport({ baseUrl: relayUrl });
  const session = await recoverAccount({
    ...rest,
    relayUrl,
    recoveryKey,
    transport,
  });
  // A new password and salt: seal now, or this device is phrase-only forever.
  await sealPasswordDoorIfProtected({
    keyStore: opts.keyStore,
    driver: opts.driver,
    password: opts.newPassword,
    write: writePasswordSidecar,
  });
  return session;
}

/**
 * Rotates the recovery phrase locally, then its relay escrow, which an offline
 * device leaves pending; `escrowPending` means the old phrase still recovers.
 */
export async function rotateRecoveryPhraseForAccount(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
  /** This device's recovery door; see {@link RecoveryDoorWriter}. */
  writeRecoveryDoor: RecoveryDoorWriter;
}): Promise<{ recoveryPhrase: string; escrowPending: boolean }> {
  const { keyStore, driver, password, writeRecoveryDoor } = opts;

  const { recoveryPhrase, masterKey } = await rotateRecoveryPhrase({
    keyStore,
    driver,
    password,
    writeRecoveryDoor,
  });

  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined || account.relayUrl === null) {
    return { recoveryPhrase, escrowPending: false };
  }

  // Marked before the attempt, so a crash mid-publish leaves it set.
  const syncState = createSyncStateRepo(driver);
  await syncState.setRecoveryEscrowPending(true);
  try {
    await flushPendingRecoveryEscrow({ keyStore, driver, masterKey });
  } catch {
    // Offline, or refused: the rotation stands, and the next sync flushes.
  }
  return {
    recoveryPhrase,
    escrowPending: await syncState.getRecoveryEscrowPending(),
  };
}

/** Publishes a pending rotation's escrow, all three recovery fields at once;
 *  returns whether it did. See the README's _The recovery escrow_. */
export async function flushPendingRecoveryEscrow(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  masterKey: Uint8Array;
}): Promise<boolean> {
  const { keyStore, driver, masterKey } = opts;
  const syncState = createSyncStateRepo(driver);
  if (!(await syncState.getRecoveryEscrowPending())) return false;

  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined || account.relayUrl === null) {
    // No relay to flush to, so the flag would stay armed forever: clear it.
    await syncState.setRecoveryEscrowPending(false);
    return false;
  }

  const recoveryKey = await readRecoveryKey(keyStore);
  if (recoveryKey === undefined) return false;

  const transport = createHttpSyncTransport({ baseUrl: account.relayUrl });
  await transport.publishRecovery({
    accountId: account.id,
    authVerifier: Uint8Array.from(account.authVerifier),
    wrappedRecoveryKey: wrapKey(recoveryKey, masterKey),
    wrappedMasterKeyRecovery: wrapKey(masterKey, recoveryKey),
    recoveryVerifier: deriveRecoveryVerifier(recoveryKey),
  });
  await syncState.setRecoveryEscrowPending(false);
  return true;
}

/**
 * Adopts the account's recovery key from the relay, once per launch; flushes
 * first and never pulls while its own rotation is pending.
 */
export async function convergeRecoveryKey(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  masterKey: Uint8Array;
  /** This device's recovery door; see {@link RecoveryDoorWriter}. */
  writeRecoveryDoor: RecoveryDoorWriter;
}): Promise<"adopted" | "unchanged" | "skipped"> {
  const { keyStore, driver, masterKey, writeRecoveryDoor } = opts;

  await flushPendingRecoveryEscrow({ keyStore, driver, masterKey });
  const syncState = createSyncStateRepo(driver);
  if (await syncState.getRecoveryEscrowPending()) return "skipped";

  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined || account.relayUrl === null) return "skipped";

  const transport = createHttpSyncTransport({ baseUrl: account.relayUrl });
  const { wrappedRecoveryKey } = await transport.fetchBootstrap({
    accountId: account.id,
    authVerifier: Uint8Array.from(account.authVerifier),
  });
  // No account-wide key to converge on, so this device keeps its own.
  if (wrappedRecoveryKey === undefined) return "skipped";

  const recoveryKey = unwrapKey(wrappedRecoveryKey, masterKey);
  if (await holdsRecoveryKey(keyStore, recoveryKey)) return "unchanged";

  await adoptRecoveryKey({
    keyStore,
    driver,
    recoveryKey,
    masterKey,
    writeRecoveryDoor,
  });
  return "adopted";
}

/** Runs one push and pull for this store's relay-bound account, flushing any
 *  pending escrow first; returns when, and how many records applied. */
export async function runAccountSync(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  masterKey: Uint8Array;
  repos: SyncableRepo<SyncRow>[];
}): Promise<{ at: number; applied: number }> {
  const { keyStore, driver, masterKey, repos } = opts;
  // First: a phrase the user has already been shown is waiting on it.
  await flushPendingRecoveryEscrow({ keyStore, driver, masterKey });
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
    repos,
  });
  const { applied } = await engine.sync();
  return { at: Date.now(), applied };
}

/** Re-authenticates after another device reset the password, from the new
 *  one; throws if the account is not relay-bound. */
export async function reauthenticateViaRelay(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
  /** This device's password door; see {@link PasswordDoorWriter}. */
  writePasswordSidecar: PasswordDoorWriter;
}): Promise<void> {
  const { keyStore, driver, password, writePasswordSidecar } = opts;
  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined) {
    throw new Error("Sync is not enabled for this store.");
  }
  if (account.relayUrl === null) {
    throw new Error("This account is not connected to a relay.");
  }
  const transport = createHttpSyncTransport({ baseUrl: account.relayUrl });
  await reauthenticate({ keyStore, driver, transport, password });
  // ⚠️ The old sidecar still expects the old password; reseal after the
  // credential transaction, so the salt read is the rotated one.
  await sealPasswordDoorIfProtected({
    keyStore,
    driver,
    password,
    write: writePasswordSidecar,
  });
}

/** Whether a sync failure is the relay's 401: the password was reset
 *  elsewhere. Matches the transport's `failed: <status>` message. */
export function isRelayAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("401");
}

/** Whether a registration failed on a taken username, the 409 a client forks
 *  on. ⚠️ Check it before rewording the error, which loses the status. */
export function isUsernameTakenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("409");
}

export interface JoinReconcileResult {
  /** Possible duplicates between this device's people and the account's. */
  duplicateCount: number;
}

/** The candidate pairs the join introduced: exactly one side a pre-existing
 *  local person. */
export function selectJoinDuplicates(
  candidates: DuplicateCandidate[],
  localIds: ReadonlySet<string>,
): DuplicateCandidate[] {
  return candidates.filter(
    (c) => localIds.has(c.a.id) !== localIds.has(c.b.id),
  );
}

/**
 * Pulls the joined account, then counts duplicates straddling local and
 * account people for review; it never merges or pushes.
 */
export async function reconcileOnJoin(opts: {
  driver: SqliteDriver;
  masterKey: Uint8Array;
  repos: SyncableRepo<SyncRow>[];
  core: { duplicates: { findCandidates(): Promise<DuplicateCandidate[]> } };
}): Promise<JoinReconcileResult> {
  const { driver, masterKey, repos, core } = opts;

  // Local people before the pull: exactly the pre-existing set.
  const localIds = new Set(
    (await createPeopleRepo(driver).list()).map((p) => p.id),
  );
  if (localIds.size === 0) return { duplicateCount: 0 };

  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined || account.relayUrl === null) {
    return { duplicateCount: 0 };
  }

  // Pull so detection sees both sets, persisting the cursor so the next sync
  // doesn't pull again.
  const engine = createAccountSyncEngine({
    driver,
    masterKey,
    relayUrl: account.relayUrl,
    accountId: account.id,
    authVerifier: account.authVerifier,
    repos,
  });
  const syncState = createSyncStateRepo(driver);
  const { cursor } = await engine.pull(await syncState.getPullCursor());
  await syncState.setPullCursor(cursor);

  const candidates = await core.duplicates.findCandidates();
  return { duplicateCount: selectJoinDuplicates(candidates, localIds).length };
}

/** This device's “Sync automatically” preference, default `true`; it never
 *  replicates. */
export function getAutoSync(opts: { driver: SqliteDriver }): Promise<boolean> {
  return createSyncStateRepo(opts.driver).getAutoSyncEnabled();
}

/** Persists the preference; the caller also tells the live scheduler. */
export function setAutoSync(opts: {
  driver: SqliteDriver;
  enabled: boolean;
}): Promise<void> {
  return createSyncStateRepo(opts.driver).setAutoSyncEnabled(opts.enabled);
}
