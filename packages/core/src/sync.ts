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
  createContactMethodsRepo,
  createDismissalsRepo,
  createGiftIdeasRepo,
  createGiftSuggestionsRepo,
  createGiftsRepo,
  createHiddenHolidaysRepo,
  createHolidaysRepo,
  createMilestonesRepo,
  createObservancesRepo,
  createMentionsRepo,
  createNotADuplicateRepo,
  createNotificationSettingsRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createReminderRulesRepo,
  createRemindersRepo,
  createSelfPersonRepo,
  createSyncStateRepo,
  createTagsRepo,
} from "@leapsake/data";
import {
  type SyncEngine,
  createHttpSyncTransport,
  createSyncEngine,
} from "@leapsake/sync";
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

/**
 * Persist this device's at-rest **password door** sidecar (`model.md` §7.5 Phase
 * 0.5). Injected rather than done here because *where* it lives is platform
 * specific — a file beside the store on desktop, a row in the unencrypted sidecar
 * database on mobile — while *when* it must be written is not, and that is the
 * part worth centralising.
 *
 * It is **required** on every wrapper that establishes or rotates a password, so
 * a client cannot quietly skip one and leave that device reachable only by the
 * recovery phrase. That failure would be invisible until the keychain was lost.
 */
export type PasswordDoorWriter = (sidecar: Uint8Array) => Promise<void>;

/**
 * Seal + persist this device's password door, **if this device has a store to put
 * a door on**.
 *
 * The guard is about **ordering**, not about a missing feature. It once covered a
 * real gap — `joinAccount` and `recoverAccount` adopted the account's master key
 * without converting this device's store, leaving a joined device Unauthenticated with no
 * db-key to seal a door around. Custody slice 6 closed that: the clients' adopt
 * flows mint this device's db-key *before* calling in here, precisely so this
 * skip becomes a real door with no change at these call sites
 * (`apps/desktop/src/main/db/adopt-account-flow.ts` explains the ordering).
 *
 * So: seal when the store is genuinely Authenticated, skip when it is not — which now
 * means skipping only for a store that legitimately has no key yet, never for a
 * join or a recover.
 */
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

/**
 * Build the **canonical sync allowlist** — every `SyncableRepo` that may leave
 * the device — over a driver and the unlocked master key. This is the single
 * production home for "what syncs": adding an entity is one more entry here, and
 * the device-local key tables (`content_key`/`key_wrap`/`sync_state`/`account`/
 * `device`) are *absent by construction*, which is what keeps sync
 * zero-knowledge (model.md §3). A guard test pins this exact set.
 *
 * **Every repo here is plaintext-row**, which is why this takes no key at all.
 * `milestones` used to be handed a content cipher so its sealed `note` decrypted
 * on collect and re-sealed under the receiving device's own content key on apply;
 * that field was retired as a layer-3 consumer on 2026-07-27 (migration 27),
 * removing the one place a device-local key had to be unwound mid-sync. The rows
 * are still protected on the wire — by the master-key *envelope* (layer 2), which
 * the engine applies, not the repos.
 */
export function syncableRepos(driver: SqliteDriver): SyncableRepo<SyncRow>[] {
  const tags = createTagsRepo(driver);
  const contactMethods = createContactMethodsRepo(driver);
  return [
    createPeopleRepo(driver),
    createPetsRepo(driver),
    createMilestonesRepo(driver),
    createRelationshipsRepo(driver),
    createDismissalsRepo(driver),
    createNotADuplicateRepo(driver),
    createRemindersRepo(driver),
    createReminderRulesRepo(driver),
    createMentionsRepo(driver),
    // The self-person singleton rides the people sync channel (its `person_id`
    // points into the people rows) — plaintext, converging by whole-row LWW on
    // its fixed PK.
    createSelfPersonRepo(driver),
    // Gift ideas — plaintext, person-agnostic rows.
    createGiftIdeasRepo(driver),
    // Gift suggestions — idea × recipient candidates.
    createGiftSuggestionsRepo(driver),
    // Gifts — dated giving events.
    createGiftsRepo(driver),
    // Holidays: the catalog syncs alongside user data so only ONE device ever
    // needs internet — a laptop that updates at a coffee shop can carry the new
    // catalog to every other device over an internet-less LAN relay. The usual
    // objection (an old device's re-seed reverting a newer catalog) dissolves
    // because catalog rows carry the release's *authored* timestamp, so LWW
    // orders them correctly by construction (research §2.3, §2.5). `observances`
    // and `hidden_holidays` are ordinary user data and must sync regardless.
    createHolidaysRepo(driver),
    createObservancesRepo(driver),
    createHiddenHolidaysRepo(driver),
    // Local-notification policy — per-device, but editable from any device
    // (plans/v0-1_08_local-notifications.md), so it rides ordinary sync like
    // any other preference row.
    createNotificationSettingsRepo(driver),
    tags,
    tags.taggings,
    contactMethods.emails,
    contactMethods.phones,
    contactMethods.postals,
    contactMethods.socials,
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
    repos: syncableRepos(driver),
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
 * (rate-limiting / the registration-token seam, apps/server/README.md).
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
  try {
    await lookupAccountId(opts);
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
 * {@link lookupAccount}'s sibling: the same unauthenticated prelogin, keeping the
 * **account id** rather than reducing it to a boolean. A miss propagates as the
 * relay's 404 rather than becoming `false`, because every caller here needs the
 * id and none of them has a "no such account" branch to take.
 *
 * The merge flow (`encryption/model.md` §7.2.2) is why this exists: it must
 * know which account the store is being re-homed *to* — the destination
 * directory is named after it — before it copies a single byte, and long before
 * a password has been checked.
 */
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

/**
 * Register a freshly-enabled account with its relay so a second device can later
 * log in: upload the public salt, unique username, and the *ciphertext*
 * `wrap(MK, KEK)` (the relay reads none of it — `encryption/sync.md` → *The
 * account-bootstrap channel*). Builds the
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
    wrappedRecoveryKey: bootstrap.wrappedRecoveryKey,
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
 *
 * **`driver` need not be the live store.** The merge flow
 * (`apps/desktop/src/main/db/merge-account-flow.ts`) points this at a *copy* it
 * owns, so a failed login damages nothing the app is using. Everything below is
 * driver-scoped — the repos, the enclave adoption, and the password door, which
 * reads its salt from whichever store it is handed — so nothing here reaches for
 * a live handle.
 */
export async function joinAccountViaRelay(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  relayUrl: string;
  username: string;
  password: string;
  label?: string;
  platform?: string;
  /** Persist this device's at-rest password door — see {@link PasswordDoorWriter}. */
  writePasswordSidecar: PasswordDoorWriter;
}): Promise<KeySession> {
  const { relayUrl, writePasswordSidecar, ...rest } = opts;
  const transport = createHttpSyncTransport({ baseUrl: relayUrl });
  const session = await joinAccount({ ...rest, relayUrl, transport });
  // A device holds its *own* db-key, so device 1's sidecar is meaningless here —
  // this device needs its own door.
  await sealPasswordDoorIfProtected({
    keyStore: opts.keyStore,
    driver: opts.driver,
    password: opts.password,
    write: writePasswordSidecar,
  });
  return session;
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
export async function recoverAccountViaRelay(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  relayUrl: string;
  username: string;
  recoveryPhrase: string;
  newPassword: string;
  label?: string;
  platform?: string;
  /** Persist this device's at-rest password door — see {@link PasswordDoorWriter}. */
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
  // A recovery sets a *new* password against a *new* salt: every input to the door
  // just changed, so seal it now or this device is phrase-only forever.
  await sealPasswordDoorIfProtected({
    keyStore: opts.keyStore,
    driver: opts.driver,
    password: opts.newPassword,
    write: writePasswordSidecar,
  });
  return session;
}

/**
 * Replace this device's recovery phrase (custody slice 8, `model.md` §6): rotate
 * the local doors through {@link rotateRecoveryPhrase}, then carry the new escrow
 * to the relay if this account has one.
 *
 * **It works offline, deliberately.** A relay-bound account's escrow is what a
 * *fresh* device recovers from, and it can only be replaced over the network — but
 * refusing to rotate without a connection would put a security action behind
 * connectivity, which is not the posture this app takes anywhere else. So the
 * local half always lands, and an unreachable relay leaves the escrow **pending**
 * for the next sync ({@link flushPendingRecoveryEscrow}) instead of failing.
 *
 * `escrowPending` in the result is the caller's cue to say so. Until the flush
 * lands, the *old* phrase is still what recovers the account and the new one is
 * not, so a user who discards the old phrase in that window and then loses this
 * device has lost the account. The copy has to tell them to keep it until this
 * device next syncs. `false` for a local-only account, where there is no escrow
 * and the new phrase is live everywhere the moment it is shown.
 */
export async function rotateRecoveryPhraseForAccount(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
  /** Persist this device's at-rest recovery door — see {@link RecoveryDoorWriter}. */
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

  // Marked *before* the attempt, not after a failure: a crash mid-publish must
  // still leave the flag set, or the relay keeps an escrow no one holds the
  // phrase for.
  const syncState = createSyncStateRepo(driver);
  await syncState.setRecoveryEscrowPending(true);
  try {
    await flushPendingRecoveryEscrow({ keyStore, driver, masterKey });
  } catch {
    // Offline, or the relay refused. The rotation itself stands; the flush is the
    // next sync's job.
  }
  return {
    recoveryPhrase,
    escrowPending: await syncState.getRecoveryEscrowPending(),
  };
}

/**
 * Carry a pending rotation's escrow to the relay — the deferred half of
 * {@link rotateRecoveryPhraseForAccount}, run at the top of every sync cycle and
 * before any peer catch-up. A no-op (one local flag read) when nothing is
 * pending, which is every sync but the one after a rotation.
 *
 * All three recovery fields go up together, because they are one key seen three
 * ways: the escrow a fresh device unwraps MK from, its inverse (so a
 * password-joining device can reveal the same phrase), and the verifier hash that
 * authenticates a recovery at all. Writing a subset would leave an account that
 * authenticates a recovery it cannot then complete.
 *
 * Returns whether it published. A device that **signed out** between rotating and
 * flushing keeps the flag set and publishes nothing: its recovery key went with
 * the sign-out, and nothing local can reconstruct it. That is recoverable rather
 * than stuck — unlocking with the *phrase* restores the key to the keychain, and
 * the next sync flushes — so the flag is deliberately not cleared.
 */
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
    // Nothing to flush to — an account that was never relay-bound, or was
    // forgotten. Clear it so the check stays honest rather than permanently armed.
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
 * Adopt a rotation another device performed — how every other device on the
 * account ends up on one phrase without the user typing anything (custody slice
 * 8). The relay already holds `wrap(recoveryKey, MK)` and this device already
 * holds MK, so it can learn the new key on its own; nothing secret is added to
 * the relay and nothing new is asked of the user.
 *
 * It also **re-arms a device that lost its recovery key at sign-out**. That key is
 * cleared with the db-key (both open the store) and a password unlock cannot
 * bring it back, so until now such a device stayed permanently phrase-less. Here
 * it simply differs from the account's key and adopts it.
 *
 * ### Flush first, and never pull while pending
 *
 * The rotating device runs this code too. If it pulled while its own escrow was
 * still pending, it would fetch the relay's **old** escrow and overwrite the key
 * it had just minted — silently invalidating a phrase already shown to the user.
 * So this flushes first and refuses to pull if the flag survives that. Both halves
 * matter: the flush is what normally clears it, the refusal is what holds when the
 * flush cannot.
 *
 * Concurrent rotations on two offline devices resolve as **last flush wins**: the
 * loser adopts the winner's key at its next run, and the phrase it displayed stops
 * working. Accepted — two people rotating the same account's phrase within one
 * offline window is not a case worth a protocol for.
 *
 * Meant to be called **once per launch**, not per sync: it costs a relay round
 * trip, and a rotation that lands mid-session is not urgent (the old phrase still
 * opens this device's file until it converges).
 */
export async function convergeRecoveryKey(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  masterKey: Uint8Array;
  /** Persist this device's at-rest recovery door — see {@link RecoveryDoorWriter}. */
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
  // Absent on an account registered against a pre-unification relay: there is no
  // account-wide key to converge on, so this device keeps its own.
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

// `resyncAfterMasterKeyRepair` moved to `@leapsake/key-custody` (`boot.ts`), beside
// `establishKeySession` — the boot sequence that decides when it runs. This package's
// index re-exports it, so callers are unaffected.

/**
 * Run one push→pull cycle for the enabled account on this store. Reads the
 * account singleton and its relay coordinates (`relayUrl`/`authVerifier`)
 * internally so an IPC handler stays one line. Returns the completion time for a
 * "last synced" indicator, plus `applied` — the number of records the pull
 * delivered, so a caller can revalidate the UI only when a pull changed
 * something. Throws if sync is not enabled, or the account is not relay-bound
 * (no `relayUrl`) — enable-sync with a relay must precede a sync.
 *
 * `keyStore` is required so this can flush a pending recovery-escrow rotation
 * first — the deferred half of an offline rotation. Required rather than optional
 * on purpose: a client that could omit it would silently leave the relay holding
 * an escrow whose phrase nobody has, and nothing would surface that until someone
 * tried to recover.
 */
export async function runAccountSync(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  masterKey: Uint8Array;
}): Promise<{ at: number; applied: number }> {
  const { keyStore, driver, masterKey } = opts;
  // Before the records: a rotation the user has already been shown is waiting on
  // this, and it is one small request against a relay we are about to talk to
  // anyway.
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
  /** Persist this device's at-rest password door — see {@link PasswordDoorWriter}. */
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
  // The subtle one. `reauthenticate` has just rotated this account's salt and
  // password key-wrap, which leaves the existing sidecar sealed under the *old*
  // password — a door that still looks present and would refuse the password the
  // user now has, discovered only on the day the keychain is gone. Re-seal after
  // the credential transaction, so the salt read here is the rotated one.
  await sealPasswordDoorIfProtected({
    keyStore,
    driver,
    password,
    write: writePasswordSidecar,
  });
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

/**
 * Whether a registration failure is the relay refusing a **username that already
 * belongs to another account** (a 409) — the same substring seam
 * {@link isRelayAuthError} uses, for the same reason.
 *
 * It gets its own predicate because a 409 is **not an error the user can only be
 * told about**: it hides two readings that want opposite outcomes — *"that is my
 * own account from my other device"* (→ merge into it) and *"that is a stranger,
 * I need a different handle"* (→ bind again under another name). Clients fork on
 * it rather than reporting it, so it must survive the trip from the transport to
 * the UI without being flattened into prose (`encryption/model.md` §7.2.2).
 *
 * ⚠️ **Check this before wrapping.** `relayErrorMessage`-style prose loses the
 * status code, so a call site that friendlies the message first can never fork
 * afterwards.
 */
export function isUsernameTakenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("409");
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
