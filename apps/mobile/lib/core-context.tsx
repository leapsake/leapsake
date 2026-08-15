import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import * as SQLite from "expo-sqlite";
import {
  type AccountBootstrap,
  type AdoptionDoor,
  type CoreApi,
  type KeySession,
  type PasswordDoorWriter,
  type RecoveryDoorWriter,
  type SyncScheduler,
  type SyncStatus,
  bindRelayToAccount,
  clearLocalAccount,
  convergeRecoveryKey,
  createCore,
  createSyncScheduler,
  createLocalAccount,
  establishKeySession,
  fetchRelayCapabilities,
  getAutoSync,
  getSyncStatus,
  isRelayAuthError,
  isUsernameTakenError,
  joinAccountViaRelay,
  KEYSTORE_SECRET_IDS,
  lockThisDevice,
  lookupAccount,
  lookupAccountId,
  MIN_PASSWORD_LENGTH,
  reauthenticateViaRelay,
  recoverAccountViaRelay,
  reconcileOnJoin,
  registerAccountWithRelay,
  rotateRecoveryPhraseForAccount,
  runAccountSync,
  runMigrations,
  seedHolidayCatalog,
  setAutoSync,
  withSyncKick,
} from "@leapsake/core";
import {
  DATABASE_KEY,
  RECOVERY_KEY,
  decodeRecoveryPhrase,
  ensureDatabaseKey,
  openDbKeyFromRecovery,
  openPasswordSidecar,
  rawKeyLiteral,
  readRecoveryKey,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import {
  createAccountRoster,
  UNAUTHENTICATED_STORE_SLOT,
  resolveActiveStore,
  storePath,
} from "@leapsake/store-layout";
import {
  clearUnclaimedDestination,
  convertStoreToEncrypted,
  destroyStoreFiles,
} from "../db/convert-store";
import { accountDoors } from "../db/doors";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";
import { deleteAccountRoster, sqliteRosterStorage } from "../db/roster-storage";
import { secureStoreKeyStore } from "../keystore/secure-store-keystore";
import { forgetAccountOnThisDevice } from "./forget-account";
import { mergeAccountOnThisDevice, openStoreUnderKey } from "./merge-account";

/**
 * Translate a relay/transport failure into copy a user can act on — the mobile
 * mirror of desktop's `relayErrorMessage` (`apps/desktop/src/main/index.ts`).
 */
function relayErrorMessage(cause: unknown, relayUrl: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("fetch failed") || message.includes("Network request")) {
    return `Couldn't reach the relay at ${relayUrl}. Make sure the sync server is running, then try again.`;
  }
  if (message.includes("409")) {
    return "That username is already taken on this relay. Pick another.";
  }
  if (message.includes("401")) {
    return "Incorrect username or password for this account.";
  }
  if (message.includes("404")) {
    return "No account found for that username on this relay.";
  }
  return `Relay request failed: ${message}`;
}

/**
 * The account / enable-sync surface (custody Phase 1). Kept deliberately separate
 * from {@link CoreApi}: enabling sync isn't a transactional core op, so — exactly
 * like desktop's separate `window.sync` bridge (not folded into `window.api`) — it
 * lives in its own context rather than on the core.
 */
export interface SyncApi {
  status(): Promise<SyncStatus>;
  /**
   * Pre-login existence probe: ask the relay whether `username` already names an
   * account, so the UI can route to create-vs-login. Unauthenticated — the same
   * prelogin a join already does, exposing nothing new.
   */
  lookup(username: string, relayUrl: string): Promise<boolean>;
  /**
   * **Create an account on this device** (`model.md` §7.2.1) — the act that
   * turns encryption on, with **no relay involved**: nothing leaves the phone.
   * The mobile counterpart of desktop's `window.sync.createAccount`.
   *
   * Under *encryption follows custody* an account is the only thing that
   * encrypts the store, so without this a mobile-only user who doesn't want
   * sync could never have one — the store would stay plaintext forever. That is
   * the whole reason this exists separately from {@link SyncApi.enable}, which
   * is the same act **plus** binding a relay.
   *
   * Returns the one-time recovery phrase for its single reveal.
   */
  createAccount(args: {
    username: string;
    password: string;
  }): Promise<{ accountId: string; recoveryKey: string }>;
  /**
   * Establish a new account + portable password door **and register its
   * bootstrap ciphertext with the relay**, returning the one-time recovery key
   * **base64-encoded** so raw key bytes never leave this layer (mirrors
   * desktop's IPC encoding). Rolls the local account back if relay registration
   * fails.
   */
  enable(args: {
    username: string;
    password: string;
    relayUrl: string;
  }): Promise<{ accountId: string; recoveryKey: string }>;
  /**
   * Log in to an existing account on a second device: fetch + unwrap the master
   * key, adopt it under this device's enclave, and **convert this device's store
   * to encrypted** — the conversion lands before the first sync pull, so no account
   * data ever reaches a plaintext file (`model.md` §7.1). The conversion re-runs the
   * bootstrap in place, so screens end up on the new store the same way account
   * creation moves them.
   */
  join(args: {
    username: string;
    password: string;
    relayUrl: string;
    // `duplicateCount` is how many possible duplicates the join surfaced between
    // this device's pre-existing people and the account's — a prompt to review.
  }): Promise<{ duplicateCount: number }>;
  /**
   * **Merge this device's local-only account into an existing synced one**
   * (`encryption/model.md` §7.2.2): the store is re-homed under the synced
   * account's id, keeps every row, and from the next launch opens under *that*
   * account's password. The local account is retired.
   *
   * A separate method from {@link SyncApi.join} rather than a mode of it. Join is
   * an accountless device's act and refuses a store that already holds an
   * account; this one *retires* an account, and the two have different guards, a
   * different ordering (the relay half runs against a copy) and different copy.
   * Folding them together would rebuild the polymorphic entry point the flow docs
   * say was deliberately cut.
   *
   * Returns the same `duplicateCount` a join does, because it ends in the same
   * place: this device's people are all pre-existing-local, so overlaps land in
   * duplicate review rather than being fused.
   */
  merge(args: {
    username: string;
    password: string;
    relayUrl: string;
  }): Promise<{ duplicateCount: number }>;
  /**
   * **Start syncing an account that already exists on this device** — bind a
   * relay to a local-only account (`model.md` §7.2). It publishes what the store
   * already holds: no password is asked for, no key is minted, no store is
   * converted, and the recovery phrase the user wrote down still opens the
   * account.
   *
   * The sibling of {@link SyncApi.merge}, and the other half of the local-only
   * branch: merge moves this data **into** an account that exists elsewhere,
   * this publishes the account that is **already here**.
   *
   * ⚠️ **`username-taken` resolves, it does not reject.** A taken handle is a
   * fork rather than a failure — it may be the user's own account on another
   * device (→ {@link SyncApi.merge}) or a stranger's (→ call this again with a
   * different name) — and only the user can say which. Every other failure still
   * rejects.
   */
  bindRelay(args: {
    username: string;
    relayUrl: string;
  }): Promise<
    | { status: "bound"; accountId: string; username: string }
    | { status: "username-taken"; username: string }
  >;
  /**
   * Recover an existing account on this device from the recovery phrase (forgot
   * password, `model.md` §6): unwrap MK from the relay's recovery escrow, set a
   * new password, adopt MK under this device's enclave, and convert this device's
   * store exactly as {@link SyncApi.join} does.
   */
  recover(args: {
    username: string;
    recoveryPhrase: string;
    newPassword: string;
    relayUrl: string;
  }): Promise<{ duplicateCount: number }>;
  /** Run one push→pull cycle against the configured relay. */
  syncNow(): Promise<{ at: number }>;
  /**
   * Re-authenticate this device after the account password was reset on another
   * device (a sync 401): re-derive this device's relay credential from the
   * re-entered password. The master key is untouched. Resolves once a sync has
   * been kicked; rejects with a friendly message on a wrong password.
   */
  reauthenticate(password: string): Promise<void>;
  /**
   * **Sign out** (`model.md` §7.3): close the store and forget the keys that open
   * it, so the password is needed to get back in. The data stays on this device,
   * encrypted — {@link SyncApi.forgetAccount} is the one that removes it. Rebuilds
   * in place, landing on the unlock gate the bootstrap already hosts.
   */
  signOut(): Promise<void>;
  /**
   * What the Forget-account confirmation needs to word itself (`model.md`
   * §7.3.1). `durableBackup` is whether the relay claims to keep a copy — `false`
   * whenever nobody said otherwise, which is what makes forgetting the last
   * device read as the deletion it is.
   */
  forgetInfo(): Promise<{
    username?: string;
    relayUrl?: string;
    durableBackup: boolean;
  }>;
  /**
   * **Forget account** (`model.md` §7.3): remove this account, its store, and its
   * unlock doors from this device, leaving it in the accountless state a fresh
   * install is in. Local only — an account on a relay or another device is
   * untouched there.
   */
  forgetAccount(): Promise<void>;
  /**
   * Factory reset: erase all local data, the encryption keys, and the recovery
   * sidecar, then rebuild the app in place as a fresh install (there is no
   * relaunch primitive on mobile, so this re-runs the bootstrap). Unrecoverable
   * unless the account was synced.
   */
  factoryReset(): Promise<void>;
  /**
   * Replace this device's recovery phrase, gated on the account password
   * (`model.md` §6). Returns the new phrase to show **once** — there is no way to
   * see it again — and `escrowPending`, `true` when the relay could not be
   * reached: until the next sync the *old* phrase is still what recovers the
   * account, and the caller must say so.
   */
  rotateRecoveryPhrase(
    password: string,
  ): Promise<{ recoveryPhrase: string; escrowPending: boolean }>;
  /** Read this install's "Sync automatically" preference (default true). */
  getAutoSync(): Promise<boolean>;
  /**
   * Persist + apply the "Sync automatically" preference for this install: store
   * it durably and flip the live scheduler so it takes effect immediately.
   */
  setAutoSync(enabled: boolean): Promise<void>;
  /**
   * Subscribe to background-sync activity (interval / foreground / write-kicked
   * runs, not just the manual button), so a screen can keep its "last synced"
   * line fresh. Returns an unsubscribe function. Mirrors desktop's
   * `window.sync.onActivity`. The payload's `changed` (a pull applied records)
   * also drives reactive invalidation via {@link useDataVersion}.
   */
  onActivity(
    listener: (payload: {
      at?: number;
      error?: string;
      changed?: boolean;
      needsReauth?: boolean;
    }) => void,
  ): () => void;
}

// Build the core exactly once for the whole app and share it through context.
// This is the multi-screen successor to the proof screen's per-effect bootstrap
// (old App.tsx): open the on-device SQLite file, run the shared migrations on
// expo-sqlite, then `createCore`. Every screen reads the ready CoreApi via
// `useCore()` and calls it in-process — no IPC, unlike desktop.
const CoreContext = createContext<CoreApi | null>(null);

/** The secret the user typed at the unlock gate, and which door they used. */
interface UnlockAnswer {
  door: "password" | "phrase";
  secret: string;
}
const SyncContext = createContext<SyncApi | null>(null);
// A monotonically-increasing counter bumped whenever a background-sync pull
// applies remote changes. `useFocusedData` depends on it, so a bump re-runs the
// focused screen's load — the in-process analogue of desktop's
// `router.revalidate()` (reactive invalidation). Defaults to 0 (no provider →
// never invalidates, so a screen used outside CoreProvider still renders).
const DataVersionContext = createContext(0);
/** The *Degraded* state (custody slice 10) as a screen needs it: why, and whether
 *  this account has a relay — which decides what may honestly be said to have
 *  stopped (see {@link CustodyBanner}). */
interface DegradedCustody {
  detail: string;
  relayBound: boolean;
}
// Null when this device can prove the account's master key. Defaults to null so a
// screen rendered outside CoreProvider reads as healthy rather than throwing.
const CustodyDegradedContext = createContext<DegradedCustody | null>(null);

/** Access the ready CoreApi. Throws if used outside a (loaded) CoreProvider. */
export function useCore(): CoreApi {
  const core = useContext(CoreContext);
  if (core === null) {
    throw new Error("useCore must be used within a CoreProvider");
  }
  return core;
}

/** Access the enable-sync surface. Throws if used outside a CoreProvider. */
export function useSync(): SyncApi {
  const sync = useContext(SyncContext);
  if (sync === null) {
    throw new Error("useSync must be used within a CoreProvider");
  }
  return sync;
}

/**
 * The reactive-invalidation signal: a counter that bumps when a background-sync
 * pull applied remote changes. Add it to a `useFocusedData` load's deps so the
 * focused screen re-reads when sync lands a peer's edits.
 */
export function useDataVersion(): number {
  return useContext(DataVersionContext);
}

/**
 * Why this device syncs nothing, or null when it syncs fine: the *Degraded* state
 * (custody slice 10, `model.md` §7.5). {@link CustodyBanner} already carries the
 * cause and the fix app-wide, so a screen reads this only to stop offering controls
 * that cannot work — which is what Settings does with its sync section.
 */
export function useCustodyDegraded(): DegradedCustody | null {
  return useContext(CustodyDegradedContext);
}

export function CoreProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<CoreApi | null>(null);
  const [sync, setSync] = useState<SyncApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The boot-time at-rest unlock prompt (model.md §6, §7.5): set when this
  // device's enclave key is gone but a sidecar survives, so the user must supply
  // a secret before the DB can open. `doors` says which are available — the
  // password leads, the phrase is the forgot-password fallback. `resolve` feeds
  // the answer back to the awaiting bootstrap; a wrong one re-sets this with an
  // `error`.
  const [recoveryPrompt, setRecoveryPrompt] = useState<{
    error?: string;
    doors: { password: boolean; phrase: boolean };
    resolve: (answer: UnlockAnswer) => void;
  } | null>(null);
  // Why this device cannot prove which master key is the account's, when that is
  // the case: the *Degraded* state (custody slice 10, `model.md` §7.5). Set by every
  // bootstrap run, so a repaired device clears it by re-opening. Unlike
  // {@link recoveryPrompt} it does not block the app — that is the whole point — it
  // raises a standing banner and keeps sync off.
  const [degraded, setDegraded] = useState<DegradedCustody | null>(null);
  // Reactive invalidation: bumped whenever a sync pull applied changes, so the
  // focused screen (via `useFocusedData` → `useDataVersion`) re-reads in place.
  const [dataVersion, setDataVersion] = useState(0);
  // Bumped by a factory reset to re-run the bootstrap effect after the data +
  // keys have been wiped, so the app re-mints a fresh key over an empty DB in
  // place — the mobile stand-in for desktop's process relaunch.
  const [resetVersion, setResetVersion] = useState(0);
  // The unlocked device key material (custody Phase 0), passed into createCore so
  // it can encrypt sensitive fields at rest under per-item content keys.
  const keySession = useRef<KeySession | null>(null);
  // The live core, mirrored in a ref so the AppState (foreground) listener — set
  // up once, before the core is built — can reach the *current* core (which a
  // later join/recover swaps) to regenerate system reminders on foreground.
  const coreRef = useRef<CoreApi | null>(null);
  // The background-sync scheduler (seamless sync): writes kick it, foregrounding
  // and the interval trigger it, the manual button routes through it. Held in a
  // ref so the AppState listener and SyncApi methods reach the live instance.
  const scheduler = useRef<SyncScheduler | null>(null);
  // Activity listeners (e.g. the Settings "last synced" line), notified on every
  // background-sync result/error — the in-process analogue of desktop's IPC event.
  const activityListeners = useRef(
    new Set<
      (payload: { at?: number; error?: string; changed?: boolean }) => void
    >(),
  );

  useEffect(() => {
    /**
     * Reconcile automated (`system`) reminders — upcoming birthdays — against the
     * given core, then, only if anything changed, bump the data version so the
     * focused screen re-reads and kick a sync so the rows propagate. Runs at boot
     * and on foreground (a new local day can bring a birthday into range).
     * Best-effort: a failure must never break the app. `regenerateSystem` isn't a
     * sync-kicking mutation (it runs off a user write), hence the explicit kick.
     */
    const regenerateSystemReminders = async (coreApi: CoreApi) => {
      try {
        const { created, updated, removed } =
          await coreApi.reminders.regenerateSystem();
        if (created > 0 || updated > 0 || removed > 0) {
          setDataVersion((v) => v + 1);
          scheduler.current?.kick();
        }
      } catch (cause) {
        console.error("regenerate system reminders failed:", cause);
      }
    };

    // Pull the peer's edits when the app returns to the foreground — the
    // event-driven companion to write-kicked pushes. (RN JS timers are suspended
    // in the background, so the interval is a foreground-only backstop anyway.)
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void scheduler.current?.autoTrigger();
      if (coreRef.current !== null) {
        void regenerateSystemReminders(coreRef.current);
      }
    });

    // Park the bootstrap on the unlock gate until the user submits a secret. The
    // gate is told which doors this store has, so it can lead with the password
    // and only offer the phrase as the forgot-password fallback (§7.5).
    const requestUnlock = (
      doors: { password: boolean; phrase: boolean },
      attemptError?: string,
    ) =>
      new Promise<UnlockAnswer>((resolve) =>
        setRecoveryPrompt({ error: attemptError, doors, resolve }),
      );

    (async () => {
      // The same keystore instance that backs the enable-sync door below.
      const keyStore = secureStoreKeyStore();

      // Which store, and in which custody state (@leapsake/store-layout) — settled
      // before anything is opened, because it decides whether a key is even
      // involved. The roster is the whole answer, exactly as on desktop.
      const activeStore = resolveActiveStore({
        accounts: await createAccountRoster(sqliteRosterStorage()).list(),
      });
      const existingDbKey = await keyStore.getSecret(DATABASE_KEY);

      // This store's two db-key doors, which live *in its own directory* (§7.5,
      // `db/doors.ts`) — so they are as per-account as the store is, and forgetting
      // one account cannot take another's doors with it. An **Unauthenticated** store has no
      // db-key to seal and therefore no doors at all: naming them here would only
      // create an empty database beside a store that needs none.
      const doors =
        activeStore.custody === "encrypted" &&
        activeStore.accountId !== undefined
          ? accountDoors(activeStore.accountId)
          : undefined;
      const recoverySidecar = await doors?.readRecovery();
      const passwordSidecar = await doors?.readPassword();

      // **The boot-time sweep** (desktop's `destroyStoreFiles` doc comment says
      // the same of its own): an Authenticated launch that still finds an Unauthenticated store is
      // one whose conversion could not delete the original — a plaintext copy of
      // data the user has already asked to encrypt. Verified on device 2026-07-29:
      // the delete at the end of account creation does *not* reliably take on
      // iOS — the file was still there, full schema and all — so this is not a
      // theoretical crash-recovery path, it is the one that actually runs.
      //
      // Safe by construction: an Unauthenticated store is only ever the pre-conversion one
      // once the roster names an account, and this launch is opening a different
      // file entirely.
      if (activeStore.custody === "encrypted") {
        try {
          await destroyStoreFiles(storePath(UNAUTHENTICATED_STORE_SLOT));
        } catch {
          // Nothing to sweep — the ordinary case.
        }
      }

      // At-rest encryption (Stage 2), now conditional on custody: an Authenticated
      // store's whole-DB key is held only in the OS enclave and the file is
      // ciphertext. Three cases (mirrors desktop's open.ts):
      //  1. enclave holds it → use it;
      //  2. no key + a sidecar survives → the enclave was wiped: recover the key
      //     through one of the two doors (password first, phrase as the
      //     forgot-password fallback — §7.5 Phase 0.5);
      //  3. no key + no sidecar → mint one.
      // An **Unauthenticated** store skips all of it: no account, so no key exists and none
      // is made — the OS keychain is never touched.
      let dbKey =
        activeStore.custody === "encrypted" ? existingDbKey : undefined;
      let recoverySecret: Uint8Array | undefined;
      // Which door this launch came through, if any — the input to slice 9's
      // master-key repair below. It carries the key material the unlock already
      // derived, never the typed password: the sidecar is sealed under the
      // account's own salt, so the KEK that opens the db-key is the same one that
      // unwraps the master key, and a second Argon2id pass on Hermes runs for
      // minutes.
      let unlockedBy: AdoptionDoor | undefined;

      if (
        activeStore.custody === "encrypted" &&
        dbKey === undefined &&
        (recoverySidecar !== undefined || passwordSidecar !== undefined)
      ) {
        const doors = {
          password: passwordSidecar !== undefined,
          phrase: recoverySidecar !== undefined,
        };
        let attemptError: string | undefined;
        for (;;) {
          const answer = await requestUnlock(doors, attemptError);
          try {
            if (answer.door === "password" && passwordSidecar !== undefined) {
              const opened = openPasswordSidecar(
                passwordSidecar,
                answer.secret,
              );
              dbKey = opened.dbKey;
              unlockedBy = {
                kind: "password",
                kek: opened.kek,
                authVerifier: opened.authVerifier,
              };
            } else if (
              answer.door === "phrase" &&
              recoverySidecar !== undefined
            ) {
              // Hold the recovery key: it is also this device's enclave copy,
              // restored below. A password unlock cannot recover it.
              recoverySecret = decodeRecoveryPhrase(answer.secret);
              dbKey = openDbKeyFromRecovery(recoverySidecar, recoverySecret);
              unlockedBy = { kind: "recovery", recoveryKey: recoverySecret };
            } else {
              throw new Error("That door is not available on this device.");
            }
            break;
          } catch {
            recoverySecret = undefined;
            attemptError =
              answer.door === "password"
                ? "That password doesn't open this database."
                : "That recovery phrase doesn't open this database.";
          }
        }
        await keyStore.setSecret(DATABASE_KEY, dbKey);
        setRecoveryPrompt(null);
      }
      if (activeStore.custody === "encrypted" && dbKey === undefined)
        dbKey = await ensureDatabaseKey(keyStore);

      // The path is derived (§7.4), never a fixed `leapsake.db`. expo-sqlite
      // accepts the nested name and creates the directory — verified on device by
      // the custody self-test.
      const db = await SQLite.openDatabaseAsync(activeStore.path);
      const driver = expoSqliteDriver(db);
      // SQLCipher requires `PRAGMA key` to precede all DB access, so supply it as
      // the very first statement on the fresh connection, before migrations. An
      // Unauthenticated store supplies none at all and opens as ordinary plaintext SQLite.
      //
      // Then force a read of page 1 to prove the key actually opens this file,
      // matching desktop's `openEncryptedDatabase` and the check the converter
      // already runs on its output. Applying a key never fails on its own — the
      // first *read* does — so without this a wrong or stale key surfaces from
      // somewhere inside `runMigrations` as SQLCipher's "file is not a database",
      // which names neither the cause nor the key. Failing here says what is
      // wrong, at the moment it becomes wrong.
      if (dbKey !== undefined) {
        await driver.exec(`PRAGMA key = "${rawKeyLiteral(dbKey)}"`);
        try {
          await driver.get("PRAGMA user_version");
        } catch (cause) {
          throw new Error(
            "Failed to open the encrypted database — wrong or missing key.",
            { cause },
          );
        }
      }
      await runMigrations(driver);
      // The bundled holiday catalog, applied only when this install hasn't seen
      // this bundle yet. Cheap no-op on every launch after the first.
      await seedHolidayCatalog({ driver });

      // The key-custody half of the boot, in one call, exactly as desktop's
      // `openActiveStore` does it (custody slices 9/10): repair a device that came
      // back through an unlock door — a door unlock means the OS keychain was lost,
      // which took this device's master key with it — finish a repair an earlier
      // launch left half-done, and produce the key session. Ordering inside is
      // load-bearing in both directions; that is why it is one shared function
      // rather than a sequence each client writes out.
      //
      // It reports rather than throws. A device that cannot prove which master key
      // is the account's is *Degraded*: the store opens and every screen works, but
      // `keySession` stays null — already this provider's "do not sync" signal — so
      // nothing divergent is pushed and the launch-time escrow catch-up cannot
      // publish a key this device cannot vouch for.
      const established = await establishKeySession({
        keyStore,
        driver,
        custody: activeStore.custody,
        door: unlockedBy,
        platform: Platform.OS,
      });
      if (established.state === "degraded") {
        console.error(
          "this device's master key could not be re-adopted:",
          established.cause,
        );
      }
      // A local as well as state: the sync surface built later in this same
      // bootstrap closes over it, and the effect re-runs (via `resetVersion`) on
      // every sign-out and reset, so it can never go stale.
      const degradedMessage =
        established.state === "degraded" ? established.message : null;
      setDegraded(
        degradedMessage === null
          ? null
          : {
              detail: degradedMessage,
              relayBound:
                (await getSyncStatus({ driver })).relayUrl !== undefined,
            },
      );
      // Custody Phase 0.5, not Phase 0: the master key is minted by account
      // creation, so an Unauthenticated store runs the core with no key session at all.
      keySession.current =
        established.state === "ok" ? (established.keySession ?? null) : null;

      // Refresh the recovery sidecar to the *current* enclave recovery key on
      // every launch (not just when missing), so it stays in step if the key was
      // later adopted — e.g. after recovering an account. An Unauthenticated store has no
      // db-key to seal and so has no sidecar.
      //
      // **Read, never mint** (mirrors desktop's open.ts). A *password* unlock
      // leaves this device without the recovery key — it stayed in the enclave
      // that was wiped, and nothing local can recover it — so minting here would
      // seal this door under a fresh key and silently invalidate the 24 words the
      // user wrote down. Nothing needs minting at boot: account creation, join,
      // and recovery each establish the recovery key before a store is opened.
      if (dbKey !== undefined && doors !== undefined) {
        if (recoverySecret === undefined)
          recoverySecret = await readRecoveryKey(keyStore);
        else await keyStore.setSecret(RECOVERY_KEY, recoverySecret);
        if (recoverySecret !== undefined) {
          await doors.writeRecovery(
            sealDbKeyForRecovery(dbKey, recoverySecret),
          );
        }
      }

      const notifyActivity = (payload: {
        at?: number;
        error?: string;
        changed?: boolean;
        needsReauth?: boolean;
      }) => {
        // A changed pull bumps the data version so focused screens re-read.
        if (payload.changed) setDataVersion((v) => v + 1);
        for (const listener of activityListeners.current) listener(payload);
      };
      // The run thunk doubles as the "is sync enabled" guard (a quiet no-op until
      // an account is set up and relay-bound), reading the current keySession so a
      // later join is picked up. A local write kicks it via withSyncKick below.
      scheduler.current = createSyncScheduler({
        autoEnabled: await getAutoSync({ driver }),
        run: async () => {
          const session = keySession.current;
          if (session === null) return undefined;
          const status = await getSyncStatus({ driver });
          if (!status.hasAccount || status.relayUrl === undefined)
            return undefined;
          return runAccountSync({
            keyStore,
            driver,
            masterKey: session.masterKey,
          });
        },
        onResult: ({ at, applied }) =>
          notifyActivity({ at, changed: applied !== undefined && applied > 0 }),
        onError: (cause) => {
          // A 401 means the relay rejected this device's credential — almost
          // always because the password was reset on another device. Flag it so
          // Settings can prompt for the new password instead of a raw error.
          if (isRelayAuthError(cause)) {
            notifyActivity({
              error:
                "Your password was changed on another device. Re-enter it to reconnect.",
              needsReauth: true,
            });
            return;
          }
          // Any other background failure: log it (autoTrigger swallows the
          // rejection so it no longer surfaces on its own) and surface it in UI.
          console.error("auto-sync failed:", cause);
          notifyActivity({
            error: cause instanceof Error ? cause.message : String(cause),
          });
        },
      });

      const bootedCore = withSyncKick(
        // `null` is this ref's "no session"; `createCore` takes the key session as
        // optional, which is what lets an Unauthenticated store run without one at all.
        createCore(driver, keySession.current ?? undefined),
        () => scheduler.current?.kick(),
      );
      coreRef.current = bootedCore;
      setCore(bootedCore);
      scheduler.current.start(); // backstop interval
      void regenerateSystemReminders(bootedCore); // birthdays atop Home
      void scheduler.current.autoTrigger(); // initial sync (skipped if auto off)
      /**
       * **Turn this device's Unauthenticated store into an account's encrypted one** — the
       * irreversible half of every path that establishes an account here: creating
       * one (§7.2.1), and joining or recovering one that already exists (§7.1).
       * All three run the identical sequence, which is why they share this:
       *
       * > **convert (original kept) → password door → roster entry → destroy the
       * > original.**
       *
       * The order is chosen for what a crash *between* two steps leaves behind (the
       * table in `db/convert-store.ts`), and it matches desktop's
       * `create-account-flow.ts` / `adopt-account-flow.ts` step for step. Two
       * things about it are load-bearing:
       *
       * - **The password door is written here, not by core.** Core seals it from
       *   inside `createLocalAccount` / `joinAccountViaRelay`, at a moment when the
       *   account id is not in scope and the store still lives at the Unauthenticated path
       *   that this function is about to delete — so a writer resolving its own
       *   destination would put the door in the directory the flow then removes.
       *   Every caller captures the bytes instead and hands them here, where the
       *   converted store's own directory exists. Desktop does exactly this.
       * - **The recovery door needs no step at all**: the Authenticated boot path this
       *   ends by re-running seals it on every launch.
       *
       * Always ends by re-running the bootstrap, success *or* failure. On success it
       * resolves Authenticated and opens the converted store; on failure the roster is
       * untouched, so it resolves Unauthenticated and re-opens the plaintext original the
       * conversion deliberately left in place — which is what keeps a mid-flow
       * throw from stranding the app on a driver this already closed.
       */
      const adoptStoreForAccount = async (opts: {
        accountId: string;
        username: string;
        /** This device's at-rest key — minted by creation, or before the relay call. */
        dbKey: Uint8Array;
        /** `seal(db-key, KEK)`, captured from core rather than written by it. */
        passwordDoor: Uint8Array;
      }) => {
        const { accountId, username, dbKey, passwordDoor } = opts;
        const roster = createAccountRoster(sqliteRosterStorage());
        const target = storePath(accountId);
        const targetDoors = accountDoors(accountId);
        scheduler.current?.stop();
        await driver.close?.();
        try {
          // A destination left by an earlier attempt that crashed before its
          // roster entry is claimed by nobody, so it is discardable — and
          // clearing it is what lets a retry convert into an empty store rather
          // than trip the converter's overwrite guard. Shared with the merge
          // flow, which needs the identical sweep for the identical reason.
          await clearUnclaimedDestination({ accountId, roster });
          await convertStoreToEncrypted({
            fromName: activeStore.path,
            toName: target,
            key: dbKey,
          });
          // Beside the store it opens, and *before* the roster entry — so a device
          // that is Authenticated from the next boot onward has had both from the same
          // moment.
          await targetDoors.writePassword(passwordDoor);
          await roster.add({
            id: accountId,
            username,
            createdAt: new Date().toISOString(),
          });

          // Past the roster entry the account **is** established, so nothing here
          // may throw: a caller that sees this fail treats the whole act as failed,
          // and `enable`'s does that by never showing the one-time recovery phrase
          // — trading a 24-word backstop for a leftover file. Observed on device
          // 2026-07-29, which is how this was found: the delete does not reliably
          // take on iOS. The Authenticated boot path this re-runs sweeps the leftover.
          try {
            await destroyStoreFiles(activeStore.path);
          } catch {
            // Swept on the next launch, a few lines below where custody resolves.
          }
        } finally {
          setResetVersion((v) => v + 1);
        }
      };

      /**
       * **Account creation, end to end** (`model.md` §7.2.1) — the single act
       * that turns encryption on, and the mobile counterpart of desktop's
       * `createAccountOnThisDevice`. Mints every key into the still-plaintext
       * store, optionally publishes the account to a relay, then hands the
       * irreversible half to {@link adoptStoreForAccount}.
       *
       * **The relay is optional, and that is the point.** Creating an account
       * locally and creating one that also binds a relay differ by exactly one
       * step — so they share this rather than existing as two sequences that
       * have to be kept in step. Desktop has had both since custody slice 4;
       * mobile only ever had the relay-bound one, which left a phone-only user
       * with no way to encrypt at all.
       */
      const createAccountHere = async (opts: {
        username: string;
        password: string;
        /** Recorded on the account when this act also binds a relay (§7.5 Phase 1). */
        relayUrl?: string;
        /**
         * Publish the account to its relay. Called **before** the store is
         * converted, so a rejected registration (a taken username, an
         * unreachable relay) rolls the account back and leaves the device
         * exactly as it was — still Unauthenticated, still plaintext, nothing on disk to
         * undo.
         */
        registerWithRelay?: (bootstrap: AccountBootstrap) => Promise<void>;
      }): Promise<{ accountId: string; recoveryKey: string }> => {
        const { username, password, relayUrl, registerWithRelay } = opts;
        if (password.length < MIN_PASSWORD_LENGTH) {
          throw new Error(
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
          );
        }
        // Creating an account is an **Unauthenticated** device's act, as it is on desktop
        // (`create-account-flow.ts`). The converter would refuse the encrypted
        // source anyway, but only after an account had been registered on a
        // relay — so say so before anything leaves the device.
        if (activeStore.custody !== "plaintext") {
          throw new Error(
            "This device already holds an account. Forget it before creating another.",
          );
        }
        const {
          accountId,
          recoveryPhrase,
          dbKey: newDbKey,
          passwordSidecar: newPasswordSidecar,
          bootstrap,
        } = await createLocalAccount({
          keyStore,
          driver,
          password,
          username,
          relayUrl,
          platform: Platform.OS,
        });
        if (registerWithRelay !== undefined) {
          try {
            await registerWithRelay(bootstrap);
          } catch (cause) {
            // Don't leave a half-enabled account behind if the relay rejects
            // it. Nothing on disk has moved yet, so this restores the exact
            // prior state.
            await clearLocalAccount({ driver });
            throw cause;
          }
        }
        // The irreversible half — the same shared sequence join and recover run.
        // It re-runs the bootstrap on its way out (the store this one opened no
        // longer exists), which is also how a failure mid-conversion lands back
        // on the plaintext original rather than on a closed driver.
        await adoptStoreForAccount({
          accountId,
          username,
          dbKey: newDbKey,
          passwordDoor: newPasswordSidecar,
        });
        return { accountId, recoveryKey: recoveryPhrase };
      };

      /**
       * The {@link PasswordDoorWriter} for the **steady state** — a device whose
       * store already sits at its account's path, re-sealing its door after a
       * password change (`reauthenticate`). Mirrors desktop's
       * `writeThisDevicePasswordDoor`.
       *
       * Deliberately *not* for the three flows that establish an account: while
       * those run, the door's destination does not exist yet. They capture the
       * bytes and hand them to {@link adoptStoreForAccount}.
       */
      const writeThisDevicePasswordDoor: PasswordDoorWriter = async (bytes) => {
        if (doors === undefined) {
          throw new Error(
            "This device has no account to seal a password door for.",
          );
        }
        await doors.writePassword(bytes);
      };

      /**
       * The {@link RecoveryDoorWriter} counterpart, for the two paths that change
       * this device's recovery key: rotating the phrase here, and adopting a
       * rotation performed on another device.
       *
       * Neither runs during a store conversion, so unlike the password writer this
       * one has no "not for the establishing flows" caveat — `doors` already names
       * the account's own directory whenever either can be reached.
       */
      const writeThisDeviceRecoveryDoor: RecoveryDoorWriter = async (bytes) => {
        if (doors === undefined) {
          throw new Error(
            "This device has no account to seal a recovery door for.",
          );
        }
        await doors.writeRecovery(bytes);
      };

      // The enable-sync surface closes over the *booted* driver + keystore, so it
      // never re-opens the DB or re-creates the keystore (custody Phase 1).
      setSync({
        status: () => getSyncStatus({ driver }),
        async lookup(username, relayUrl) {
          try {
            return await lookupAccount({ relayUrl, username });
          } catch (cause) {
            throw new Error(relayErrorMessage(cause, relayUrl), { cause });
          }
        },
        createAccount: ({ username, password }) =>
          createAccountHere({ username, password }),
        enable({ username, password, relayUrl }) {
          // Enabling sync **is** creating an account that also binds a relay, so
          // it is the local act plus one step (@leapsake/key-custody). The relay half
          // is a callback rather than a branch so the failure it owns — a taken
          // username, an unreachable host — is worded here, where the URL is.
          return createAccountHere({
            username,
            password,
            relayUrl,
            registerWithRelay: async (bootstrap) => {
              try {
                await registerAccountWithRelay({ relayUrl, bootstrap });
              } catch (cause) {
                throw new Error(relayErrorMessage(cause, relayUrl), { cause });
              }
            },
          });
        },
        async join({ username, password, relayUrl }) {
          const wasOpen = activeStore.custody === "plaintext";
          // This device's own at-rest key, minted *before* the relay call: core
          // seals the password door from inside `joinAccountViaRelay`, and its
          // `sealPasswordDoorIfProtected` skips while there is no db-key to seal.
          // Minting first is what turns that skip into a real door, with no change
          // at the call site. Safe while Unauthenticated — custody is decided purely by the
          // roster, and the Unauthenticated boot branch ignores a db-key entirely.
          if (wasOpen) await ensureDatabaseKey(keyStore);
          // Capture the door core seals rather than letting it write: while this
          // runs the store is still the Unauthenticated one, which the conversion below
          // deletes. See {@link adoptStoreForAccount}.
          let passwordDoor: Uint8Array | undefined;
          let session: KeySession;
          try {
            session = await joinAccountViaRelay({
              keyStore,
              driver,
              writePasswordSidecar: async (bytes) => {
                passwordDoor = bytes;
              },
              relayUrl,
              username,
              password,
              platform: Platform.OS,
            });
          } catch (cause) {
            throw new Error(relayErrorMessage(cause, relayUrl), { cause });
          }
          // With a db-key in hand `sealPasswordDoorIfProtected` cannot legitimately
          // skip, so an unsealed door means that contract broke. Fail here, before
          // anything on disk moves, rather than hand the user a device only its
          // 24-word phrase can open.
          if (passwordDoor === undefined) {
            throw new Error(
              "Joining did not seal this device's password door; refusing to convert the store.",
            );
          }
          // Adopt the account's master key everywhere: rebuild the core (wrapped
          // so writes keep kicking) on the adopted session and swap it in place
          // (desktop does this via its IPC Proxy; here `setCore` re-renders
          // consumers with the new core).
          keySession.current = session;
          const joinedCore = withSyncKick(createCore(driver, session), () =>
            scheduler.current?.kick(),
          );
          coreRef.current = joinedCore;
          setCore(joinedCore);
          // Reconcile this device's pre-existing local people against the
          // account: pull first, then count the possible duplicates the join
          // surfaced so the screen can prompt the user to review them (no
          // auto-merge). Best-effort — a failure here must not fail the join.
          let duplicateCount = 0;
          try {
            ({ duplicateCount } = await reconcileOnJoin({
              driver,
              masterKey: session.masterKey,
              core: joinedCore,
            }));
          } catch {
            duplicateCount = 0;
          }
          if (wasOpen) {
            // Convert before anything syncs in. The bootstrap this re-runs kicks
            // its own sync, so nothing is triggered here.
            const { accountId } = await getSyncStatus({ driver });
            if (accountId === undefined) {
              throw new Error(
                "Joining did not record an account on this store.",
              );
            }
            const dbKey = await keyStore.getSecret(DATABASE_KEY);
            if (dbKey === undefined) {
              throw new Error(
                "This device has no database key to convert with.",
              );
            }
            await adoptStoreForAccount({
              accountId,
              username,
              dbKey,
              passwordDoor,
            });
            return { duplicateCount };
          }
          // Already Authenticated: the store is where it belongs, so the freshly sealed
          // door belongs in its account's own directory.
          await writeThisDevicePasswordDoor(passwordDoor);
          void scheduler.current?.autoTrigger(); // push this device's data + pull remainder
          return { duplicateCount };
        },
        /**
         * **Merge a local-only account into a synced one** — the ordering,
         * the guards and the crash table all live on
         * {@link mergeAccountOnThisDevice}; this is the wiring around it.
         *
         * Three things are this layer's own, and none of them are tidying:
         *
         * 1. **`closed` is mobile's `storeSwapping`.** Desktop's `withStoreSwap`
         *    re-opens the store after a failed swap only when the handle actually
         *    died; the same distinction matters here, because a guard that
         *    refuses before anything moves (already signed in, same account
         *    twice) leaves a live driver and a running scheduler, and re-running
         *    the bootstrap over that would throw the user's screen away to report
         *    a validation error.
         * 2. **The reconcile runs here, not in the flow**, and on a connection of
         *    its own. Mobile's "re-open" is a bootstrap effect, which React
         *    schedules and this cannot await — so the only way to return an
         *    honest `duplicateCount` is to open the merged store once, reconcile,
         *    and close it before handing the bootstrap its turn. The pull cursor
         *    it persists is what stops the following boot re-pulling.
         * 3. **The session comes back through `adopt`.** The flow hands the copy
         *    to the join and keeps the session it returns; the reconcile needs
         *    that master key, and re-deriving it here would mean a second relay
         *    round trip for something already in hand.
         */
        async merge({ username, password, relayUrl }) {
          let session: KeySession | undefined;
          let closed = false;
          let accountId: string;
          try {
            ({ accountId } = await mergeAccountOnThisDevice({
              keyStore,
              driver,
              roster: createAccountRoster(sqliteRosterStorage()),
              username,
              prelogin: async () => {
                try {
                  return await lookupAccountId({ relayUrl, username });
                } catch (cause) {
                  throw new Error(relayErrorMessage(cause, relayUrl), {
                    cause,
                  });
                }
              },
              // Note the driver: the merge hands over a copy of this device's
              // store, not the live one, so a refused login damages nothing.
              adopt: async (copy, writePasswordSidecar) => {
                try {
                  session = await joinAccountViaRelay({
                    keyStore,
                    driver: copy,
                    relayUrl,
                    username,
                    password,
                    platform: Platform.OS,
                    writePasswordSidecar,
                  });
                  return session;
                } catch (cause) {
                  throw new Error(relayErrorMessage(cause, relayUrl), {
                    cause,
                  });
                }
              },
              closeStore: async () => {
                closed = true;
                scheduler.current?.stop();
                await driver.close?.();
              },
            }));
          } catch (cause) {
            // Only a failure past `closeStore` left the app on a dead handle.
            // Re-resolving custody from the roster picks the right store either
            // way: the original if the merge never reached its roster write, the
            // merged one if it did.
            if (closed) setResetVersion((v) => v + 1);
            throw cause;
          }

          // Past the roster swap. Everything below is best-effort — the merge has
          // already happened, and a device that lands on the merged store with an
          // un-run duplicate scan is merely un-prompted, not broken.
          let duplicateCount = 0;
          const dbKey = await keyStore.getSecret(DATABASE_KEY);
          if (session !== undefined && dbKey !== undefined) {
            try {
              const merged = await openStoreUnderKey(
                storePath(accountId),
                dbKey,
              );
              try {
                ({ duplicateCount } = await reconcileOnJoin({
                  driver: merged,
                  masterKey: session.masterKey,
                  // Transient and unwrapped: nothing here writes, so there is no
                  // sync to kick, and this core is closed a few lines below.
                  core: createCore(merged, session),
                }));
              } finally {
                await merged.close?.();
              }
            } catch (cause) {
              console.error("post-merge reconcile failed:", cause);
              duplicateCount = 0;
            }
          }
          // The store under this provider is gone; the bootstrap re-run lands the
          // app on the merged one and starts its sync.
          setResetVersion((v) => v + 1);
          return { duplicateCount };
        },
        /**
         * **Bind a relay to this device's local-only account.** Unlike every
         * other flow on this surface it touches no file: the store keeps its
         * name, its key and its doors, so there is no conversion, no roster
         * write and no bootstrap re-run. Two columns change.
         *
         * The 409 is passed through raw rather than friendlied, because
         * `relayErrorMessage` would flatten the status into prose and the fork
         * below could never see it.
         */
        async bindRelay({ username, relayUrl }) {
          try {
            const bound = await bindRelayToAccount({
              keyStore,
              driver,
              username,
              relayUrl,
              registerWithRelay: async (bootstrap) => {
                try {
                  await registerAccountWithRelay({ relayUrl, bootstrap });
                } catch (cause) {
                  if (isUsernameTakenError(cause)) throw cause;
                  throw new Error(relayErrorMessage(cause, relayUrl), {
                    cause,
                  });
                }
              },
            });
            // Bound, so this account now syncs — start it without waiting. The
            // scheduler re-reads `getSyncStatus` on every run, so the binding is
            // picked up with no restart.
            void scheduler.current?.autoTrigger();
            return { status: "bound" as const, ...bound };
          } catch (cause) {
            if (isUsernameTakenError(cause)) {
              return { status: "username-taken" as const, username };
            }
            throw cause;
          }
        },
        async recover({ username, recoveryPhrase, newPassword, relayUrl }) {
          if (newPassword.length < MIN_PASSWORD_LENGTH) {
            throw new Error(
              `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            );
          }
          const wasOpen = activeStore.custody === "plaintext";
          // Same reason as join: mint before the relay call so core's password door
          // is sealed rather than skipped.
          if (wasOpen) await ensureDatabaseKey(keyStore);
          // Captured, not written — same reason as join.
          let passwordDoor: Uint8Array | undefined;
          let session: KeySession;
          try {
            session = await recoverAccountViaRelay({
              keyStore,
              driver,
              writePasswordSidecar: async (bytes) => {
                passwordDoor = bytes;
              },
              relayUrl,
              username,
              recoveryPhrase,
              newPassword,
              platform: Platform.OS,
            });
          } catch (cause) {
            throw new Error(relayErrorMessage(cause, relayUrl), { cause });
          }
          if (passwordDoor === undefined) {
            throw new Error(
              "Recovering did not seal this device's password door; refusing to convert the store.",
            );
          }
          // Adopt the recovered master key everywhere, like join.
          keySession.current = session;
          const recoveredCore = withSyncKick(createCore(driver, session), () =>
            scheduler.current?.kick(),
          );
          coreRef.current = recoveredCore;
          setCore(recoveredCore);
          let duplicateCount = 0;
          try {
            ({ duplicateCount } = await reconcileOnJoin({
              driver,
              masterKey: session.masterKey,
              core: recoveredCore,
            }));
          } catch {
            duplicateCount = 0;
          }
          if (wasOpen) {
            const { accountId } = await getSyncStatus({ driver });
            if (accountId === undefined) {
              throw new Error(
                "Recovering did not record an account on this store.",
              );
            }
            const dbKey = await keyStore.getSecret(DATABASE_KEY);
            if (dbKey === undefined) {
              throw new Error(
                "This device has no database key to convert with.",
              );
            }
            await adoptStoreForAccount({
              accountId,
              username,
              dbKey,
              passwordDoor,
            });
            return { duplicateCount };
          }
          await writeThisDevicePasswordDoor(passwordDoor);
          void scheduler.current?.autoTrigger();
          return { duplicateCount };
        },
        // Route through the scheduler so the button and background syncs share
        // single-flight; a guarded skip (not enabled) surfaces as the same error.
        async syncNow() {
          // A Degraded device skips for a completely different reason than a store
          // with no account, and "sync is not enabled" would send the user off to
          // create an account they already have (custody slice 10).
          if (degradedMessage !== null) throw new Error(degradedMessage);
          const result = await scheduler.current?.trigger();
          if (result === undefined) {
            throw new Error("Sync is not enabled for this store.");
          }
          return result;
        },
        // Re-derive this device's relay credential from the re-entered password
        // (the MK stays in the enclave), then kick a sync so a success reconnects
        // immediately.
        async reauthenticate(password) {
          const { relayUrl } = await getSyncStatus({ driver });
          try {
            await reauthenticateViaRelay({
              keyStore,
              driver,
              password,
              writePasswordSidecar: writeThisDevicePasswordDoor,
            });
          } catch (cause) {
            throw new Error(relayErrorMessage(cause, relayUrl ?? ""), {
              cause,
            });
          }
          await scheduler.current?.trigger();
        },
        // **Sign out** (@leapsake/key-custody). Mobile has no relaunch primitive, so the
        // whole act is: forget the two keys that open this store, then re-run the
        // bootstrap. That re-run finds the roster still naming the account
        // (Authenticated) but no db-key, with both doors intact — which is exactly the
        // gate case above, so the unlock prompt raises itself. No new mechanism.
        //
        // The two guards mirror desktop's, and both refuse rather than repair:
        // an Unauthenticated store has no account and no password to come back with, and a
        // device with no password door would be locked behind the 24-word phrase
        // alone, which is a support incident rather than a sign out.
        async signOut() {
          if ((await getSyncStatus({ driver })).hasAccount !== true) {
            throw new Error(
              "There is no account on this device to sign out of. Create one to " +
                "protect your data with a password.",
            );
          }
          if ((await doors?.readPassword()) === undefined) {
            throw new Error(
              "This device has no password door, so signing out would lock the " +
                "data behind the recovery phrase alone.",
            );
          }
          setCore(null);
          setSync(null);
          scheduler.current?.stop();
          await driver.close?.();
          await lockThisDevice({ keyStore });
          keySession.current = null;
          coreRef.current = null;
          setResetVersion((v) => v + 1);
        },
        async forgetInfo() {
          const { hasAccount, username, relayUrl } = await getSyncStatus({
            driver,
          });
          if (hasAccount !== true) {
            throw new Error("There is no account on this device.");
          }
          const { durableBackup } = await fetchRelayCapabilities({ relayUrl });
          return { username, relayUrl, durableBackup };
        },
        // **Forget account** (@leapsake/key-custody). The roster is the authority for
        // *which* store — it names it, and it is what the next bootstrap reads —
        // so with the entry gone the re-run resolves Unauthenticated and lands the device on
        // a fresh plaintext store, the state a new install is in.
        async forgetAccount() {
          const accountId =
            activeStore.custody === "encrypted"
              ? activeStore.accountId
              : undefined;
          if (accountId === undefined) {
            throw new Error("There is no account on this device to forget.");
          }
          setCore(null);
          setSync(null);
          scheduler.current?.stop();
          await driver.close?.();
          await forgetAccountOnThisDevice({
            keyStore,
            roster: createAccountRoster(sqliteRosterStorage()),
            accountId,
            storeName: activeStore.path,
            deleteStore: (name) => SQLite.deleteDatabaseAsync(name),
            // This account's doors only — they live in its own store directory, so
            // a second account on this device keeps both of its own (slice 7b).
            deleteDoors: () => accountDoors(accountId).destroy(),
          });
          keySession.current = null;
          coreRef.current = null;
          setResetVersion((v) => v + 1);
        },
        async factoryReset() {
          // Show the loading state first so the wiped core is never rendered,
          // then tear everything down: stop background sync, close the DB handle,
          // delete this store, its doors and the account roster, and clear every
          // keystore secret. Bumping resetVersion re-runs the bootstrap effect,
          // which now finds no roster, no key and no store, and so takes the
          // *Unauthenticated* path — a plaintext store and no keys at all (@leapsake/key-custody).
          //
          // Clearing the roster is what makes that true. Left behind, it would
          // send the next boot looking for the store of an account the user had
          // just erased and mint a fresh key over an empty encrypted database,
          // landing them back in an Authenticated state.
          setCore(null);
          setSync(null);
          scheduler.current?.stop();
          await driver.close?.();
          await SQLite.deleteDatabaseAsync(activeStore.path);
          await doors?.destroy();
          await deleteAccountRoster();
          for (const id of KEYSTORE_SECRET_IDS) {
            await keyStore.deleteSecret(id);
          }
          keySession.current = null;
          coreRef.current = null;
          setResetVersion((v) => v + 1);
        },
        // Replaces this device's phrase rather than revealing it (custody slice
        // 8, mirroring desktop): a phrase is shown once at account creation, and
        // rotation is the only later route to one. Gated on the password, checked
        // locally by core — so it works on a local-only account and offline, with
        // `escrowPending` telling the caller the relay has not been told yet.
        rotateRecoveryPhrase: (password) =>
          rotateRecoveryPhraseForAccount({
            keyStore,
            driver,
            password,
            writeRecoveryDoor: writeThisDeviceRecoveryDoor,
          }),
        getAutoSync: () => getAutoSync({ driver }),
        async setAutoSync(enabled) {
          await setAutoSync({ driver, enabled });
          scheduler.current?.setAutoEnabled(enabled);
        },
        onActivity(listener) {
          activityListeners.current.add(listener);
          return () => activityListeners.current.delete(listener);
        },
      });

      // Once per launch, take on a phrase rotated on another device — and, on a
      // device that lost its recovery key at sign-out, get one back (custody slice
      // 8, `model.md` §6). Fire-and-forget and silent on failure: it is
      // convergence, not something the user asked for, so an unreachable relay or
      // a local-only account simply means there is nothing to converge on yet.
      //
      // Last in the bootstrap because it needs `writeThisDeviceRecoveryDoor`,
      // which is declared with the rest of the sync surface above.
      const session = keySession.current;
      if (session !== null && doors !== undefined) {
        void convergeRecoveryKey({
          keyStore,
          driver,
          masterKey: session.masterKey,
          writeRecoveryDoor: writeThisDeviceRecoveryDoor,
        }).catch((cause: unknown) => {
          console.error("recovery-key catch-up failed:", cause);
        });
      }
    })().catch((e) => setError(String(e)));

    return () => {
      appStateSub.remove();
      scheduler.current?.stop();
    };
  }, [resetVersion]);

  if (error !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (recoveryPrompt !== null) {
    return (
      <RecoveryGate
        error={recoveryPrompt.error}
        doors={recoveryPrompt.doors}
        onSubmit={recoveryPrompt.resolve}
      />
    );
  }

  if (core === null || sync === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <CoreContext.Provider value={core}>
      <SyncContext.Provider value={sync}>
        <DataVersionContext.Provider value={dataVersion}>
          <CustodyDegradedContext.Provider value={degraded}>
            {degraded === null ? (
              children
            ) : (
              <DegradedFrame
                degraded={degraded}
                onSignOut={() => sync.signOut()}
              >
                {children}
              </DegradedFrame>
            )}
          </CustodyDegradedContext.Provider>
        </DataVersionContext.Provider>
      </SyncContext.Provider>
    </CoreContext.Provider>
  );
}

/**
 * Put {@link CustodyBanner} above the whole app without breaking the app's own
 * layout — the awkward half of showing a persistent banner over a navigator.
 *
 * Two things have to be true at once, and neither is automatic:
 *
 * 1. **The banner owns the top safe area.** It is the topmost thing on screen, so
 *    nothing else pads it away from the status bar and the notch; without the inset
 *    its first line renders under the clock.
 * 2. **Nothing below it may claim that inset again.** The navigator underneath still
 *    believes it starts at the top of the screen, so its header adds a second
 *    status-bar's worth of padding — a dead band between the banner and the first
 *    header, exactly as wide as the notch. Overriding the context (rather than
 *    hard-coding a negative margin) is what actually informs it: the inset has been
 *    consumed, there is none left.
 *
 * Left/right insets are passed straight through — they matter in landscape, and the
 * banner spans the full width, so it honors them itself rather than zeroing them.
 * The bottom inset is untouched, which is what keeps the tab bar clear of the home
 * indicator.
 *
 * Only mounted while the device is Degraded, so the ordinary app is unaffected by
 * any of it.
 */
function DegradedFrame({
  degraded,
  onSignOut,
  children,
}: {
  degraded: DegradedCustody;
  onSignOut: () => Promise<void>;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.frame}>
      <CustodyBanner
        detail={degraded.detail}
        relayBound={degraded.relayBound}
        onSignOut={onSignOut}
        insets={insets}
      />
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={styles.frameBody}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

/**
 * The **Degraded** state's standing notice (custody slice 10, encryption
 * `model.md` §7.5), the mobile counterpart of desktop's `CustodyBanner`: this
 * device's store opened and every screen works, but the device cannot prove which
 * master key belongs to the account, so it syncs nothing until that is repaired.
 *
 * A banner rather than a gate, deliberately. The cause is invisible to the person it
 * happens to — a restored phone, a reinstall, a changed signing identity — and their
 * data is on the device and readable, so refusing to open the app (which is what
 * slice 9 did) punishes them for something they cannot see or act on. What they do
 * need to know is that sync has stopped, because a silent one-device island is what
 * actually costs them work.
 *
 * **The way out is the unlock gate.** Signing out re-runs the bootstrap into that
 * gate, where the *other* door is one tap away — a phrase door is untouched by a
 * broken password door and vice versa — and the next open re-runs the repair with it.
 */
function CustodyBanner({
  detail,
  relayBound,
  onSignOut,
  insets,
}: {
  detail: string;
  /**
   * Whether this account has a relay. It decides what this banner may honestly say
   * has stopped: an account with a relay *had* sync and no longer has it, while an
   * account with none never did — telling that person "sync is paused" invents both
   * a feature they do not use and a loss they have not suffered. The repair matters
   * to them either way, because the moment they add a relay or a second device this
   * device would be the odd one out.
   */
  relayBound: boolean;
  onSignOut: () => Promise<void>;
  /** The safe area this banner is responsible for — see {@link DegradedFrame}. */
  insets: { top: number; left: number; right: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  function signOut() {
    setSignOutError(null);
    // The gate takes over as soon as the bootstrap re-runs, so nothing awaits this.
    // The one refusal worth showing is "no password door" — the honest answer then
    // is Forget account in Settings.
    onSignOut().catch((cause: unknown) => {
      setSignOutError(cause instanceof Error ? cause.message : String(cause));
    });
  }

  return (
    <View
      style={[
        styles.banner,
        {
          paddingTop: insets.top + 12,
          paddingLeft: insets.left + 16,
          paddingRight: insets.right + 16,
        },
      ]}
    >
      <Text style={styles.bannerTitle}>
        {relayBound
          ? "⚠ Sync is paused on this device."
          : "⚠ This device needs to be re-linked to your account."}
      </Text>
      <Text style={styles.bannerBody}>
        Your data is safe and still here.{" "}
        {relayBound
          ? "This device needs to be re-linked to your account before it can sync again."
          : "Nothing is lost — but until you re-link it, this device can't sync or be joined by another device."}
      </Text>
      <Pressable onPress={() => setExpanded(!expanded)}>
        <Text style={styles.bannerLink}>
          {expanded ? "Hide details" : "How to fix this"}
        </Text>
      </Pressable>
      {expanded && (
        <>
          <Text style={styles.bannerBody}>
            Sign out and unlock this device again. If you got here after
            entering your password, use your 24-word recovery phrase this time —
            and if you used the phrase, use your password.
          </Text>
          <Text style={styles.bannerDetail}>{detail}</Text>
          <Pressable style={styles.button} onPress={signOut}>
            <Text>Sign out and unlock</Text>
          </Pressable>
          {signOutError !== null && (
            <Text style={styles.error}>{signOutError}</Text>
          )}
        </>
      )}
    </View>
  );
}

/**
 * The boot-time at-rest **unlock gate** (encryption `model.md` §6, §7.5), the
 * mobile counterpart to desktop's `RecoveryGate`. Shown before the app loads when
 * the enclave key is missing but a sidecar survives; the typed secret is fed back
 * to the awaiting bootstrap, which unwraps the whole-DB key and reopens the file.
 * A wrong secret comes back as `error`, re-enabling the form.
 *
 * **The password is the primary door.** Someone who remembers their password
 * should never be sent hunting for 24 words they may never have written down, so
 * the phrase sits behind a "forgot your password?" action. Only the doors this
 * store actually has are offered.
 */
function RecoveryGate({
  error,
  doors,
  onSubmit,
}: {
  error?: string;
  doors: { password: boolean; phrase: boolean };
  onSubmit: (answer: UnlockAnswer) => void;
}) {
  // Which door is showing, and whether the *user* picked it. Prefer the password
  // whenever this store has one; the phrase is the forgot-password fallback, so
  // leading with it would be backwards.
  const [door, setDoor] = useState<"password" | "phrase">("password");
  const [chosen, setChosen] = useState(false);
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!chosen) setDoor(doors.password ? "password" : "phrase");
  }, [chosen, doors.password]);

  // A new prompt means the last attempt came back — let the user try again.
  //
  // Keyed on `onSubmit`, which is the awaiting bootstrap's `resolve` and is a new
  // function for every attempt, **not** on `error`: two wrong passwords in a row
  // produce the *same* error string, so an error-keyed effect never re-fires and
  // the button stays on "Checking…" forever. Getting a password wrong twice is
  // exactly when someone is trying hardest to get in, and force-quitting the app
  // was the only way out.
  useEffect(() => setSubmitting(false), [onSubmit]);

  function submit() {
    if (secret.trim() === "") return;
    setSubmitting(true);
    onSubmit({ door, secret });
  }

  function switchTo(next: "password" | "phrase") {
    setChosen(true);
    setDoor(next);
    setSecret("");
  }

  return (
    <View style={styles.gate}>
      {/*
        Names no cause, because this gate now has two (mirrors desktop's): the
        user signed out deliberately (@leapsake/key-custody), or this device's secure
        storage was reset and took the key with it. Asserting the second — as
        this used to — reads as an alarming malfunction to someone who simply
        signed out a moment ago.
      */}
      <Text style={styles.gateTitle}>Unlock your data</Text>
      <Text style={styles.gateBody}>
        Your data on this device is encrypted and locked — either because you
        signed out, or because this device's secure storage was reset. It is
        still here.{" "}
        {door === "password"
          ? "Enter your password to unlock it."
          : "Enter your recovery phrase to unlock it."}
      </Text>
      {door === "password" ? (
        <TextInput
          value={secret}
          onChangeText={setSecret}
          editable={!submitting}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Your password"
          style={styles.gateInput}
        />
      ) : (
        <TextInput
          value={secret}
          onChangeText={setSecret}
          editable={!submitting}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Enter your 24-word recovery phrase…"
          style={styles.gateInput}
        />
      )}
      {error !== undefined && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.gateButton, submitting && { opacity: 0.5 }]}
        disabled={submitting}
        onPress={submit}
      >
        <Text style={styles.gateButtonText}>
          {submitting ? "Checking…" : "Unlock"}
        </Text>
      </Pressable>
      {door === "password" && doors.phrase && (
        <Pressable onPress={() => switchTo("phrase")}>
          <Text style={styles.gateLink}>
            Forgot your password? Use your 24-word recovery phrase
          </Text>
        </Pressable>
      )}
      {door === "phrase" && doors.password && (
        <Pressable onPress={() => switchTo("password")}>
          <Text style={styles.gateLink}>Use your password instead</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  error: {
    fontSize: 14,
    color: "#b00020",
  },
  gate: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  gateTitle: {
    fontSize: 20,
    fontWeight: "600",
  },
  gateBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  gateInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 12,
    minHeight: 88,
    fontFamily: "Courier",
    textAlignVertical: "top",
  },
  gateButton: {
    backgroundColor: "#2563eb",
    borderRadius: 6,
    padding: 14,
    alignItems: "center",
  },
  gateButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  /** The secondary door, deliberately quieter than the primary Unlock button. */
  gateLink: {
    marginTop: 16,
    textAlign: "center",
    textDecorationLine: "underline",
  },
  /** {@link DegradedFrame}: banner on top, the whole app filling what is left. */
  frame: {
    flex: 1,
  },
  frameBody: {
    flex: 1,
  },
  /**
   * The Degraded-state notice ({@link CustodyBanner}) — a strip above the app.
   * Its top and horizontal padding come from the safe area at render time (see
   * {@link DegradedFrame}); only the bottom is fixed here.
   */
  banner: {
    backgroundColor: "#fff4e5",
    borderBottomWidth: 1,
    borderBottomColor: "#e0b070",
    paddingBottom: 12,
    gap: 6,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  bannerBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  bannerDetail: {
    fontSize: 12,
    color: "#6b5330",
  },
  bannerLink: {
    fontSize: 13,
    textDecorationLine: "underline",
  },
  button: {
    borderWidth: 1,
    borderColor: "#999",
    borderRadius: 6,
    padding: 10,
    alignItems: "center",
  },
});
