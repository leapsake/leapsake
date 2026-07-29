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
import * as SQLite from "expo-sqlite";
import {
  type AccountBootstrap,
  type CoreApi,
  type KeySession,
  type PasswordDoorWriter,
  type SyncScheduler,
  type SyncStatus,
  clearLocalAccount,
  createCore,
  createSyncScheduler,
  createLocalAccount,
  ensureDeviceMasterKey,
  fetchRelayCapabilities,
  getAutoSync,
  getSyncStatus,
  isRelayAuthError,
  joinAccountViaRelay,
  KEYSTORE_SECRET_IDS,
  lockThisDevice,
  lookupAccount,
  MIN_PASSWORD_LENGTH,
  reauthenticateViaRelay,
  recoverAccountViaRelay,
  reconcileOnJoin,
  registerAccountWithRelay,
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
  encodeRecoveryPhrase,
  ensureDatabaseKey,
  openDbKeyFromRecovery,
  openDbKeyWithPassword,
  rawKeyLiteral,
  readRecoveryKey,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import {
  createAccountRoster,
  OPEN_STORE_SLOT,
  resolveActiveStore,
  storePath,
} from "@leapsake/store-layout";
import {
  convertStoreToEncrypted,
  destroyPlaintextStore,
} from "../db/convert-store";
import { accountDoors } from "../db/doors";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";
import { deleteAccountRoster, sqliteRosterStorage } from "../db/roster-storage";
import { secureStoreKeyStore } from "../keystore/secure-store-keystore";
import { forgetAccountOnThisDevice } from "./forget-account";

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
   * to encrypted** — a joining device is Protected from byte one (`model.md`
   * §7.1). The conversion re-runs the bootstrap in place, so screens end up on the
   * new store the same way account creation moves them.
   */
  join(args: {
    username: string;
    password: string;
    relayUrl: string;
    // `duplicateCount` is how many possible duplicates the join surfaced between
    // this device's pre-existing people and the account's — a prompt to review.
  }): Promise<{ duplicateCount: number }>;
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
  /** Reveal this device's recovery phrase (the words back into the data). */
  revealRecoveryPhrase(): Promise<string>;
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

      // Which store, and in which custody state (model.md §7.2/§7.4) — settled
      // before anything is opened, because it decides whether a key is even
      // involved. The roster is the whole answer, exactly as on desktop.
      const activeStore = resolveActiveStore({
        accounts: await createAccountRoster(sqliteRosterStorage()).list(),
      });
      const existingDbKey = await keyStore.getSecret(DATABASE_KEY);

      // This store's two db-key doors, which live *in its own directory* (§7.5,
      // `db/doors.ts`) — so they are as per-account as the store is, and forgetting
      // one account cannot take another's doors with it. An **Open** store has no
      // db-key to seal and therefore no doors at all: naming them here would only
      // create an empty database beside a store that needs none.
      const doors =
        activeStore.custody === "protected" &&
        activeStore.accountId !== undefined
          ? accountDoors(activeStore.accountId)
          : undefined;
      const recoverySidecar = await doors?.readRecovery();
      const passwordSidecar = await doors?.readPassword();

      // **The boot-time sweep** (desktop's `destroyPlaintextStore` doc comment says
      // the same of its own): a Protected launch that still finds an Open store is
      // one whose conversion could not delete the original — a plaintext copy of
      // data the user has already asked to encrypt. Verified on device 2026-07-29:
      // the delete at the end of account creation does *not* reliably take on
      // iOS — the file was still there, full schema and all — so this is not a
      // theoretical crash-recovery path, it is the one that actually runs.
      //
      // Safe by construction: an Open store is only ever the pre-conversion one
      // once the roster names an account, and this launch is opening a different
      // file entirely.
      if (activeStore.custody === "protected") {
        try {
          await destroyPlaintextStore(storePath(OPEN_STORE_SLOT));
        } catch {
          // Nothing to sweep — the ordinary case.
        }
      }

      // At-rest encryption (Stage 2), now conditional on custody: a Protected
      // store's whole-DB key is held only in the OS enclave and the file is
      // ciphertext. Three cases (mirrors desktop's open.ts):
      //  1. enclave holds it → use it;
      //  2. no key + a sidecar survives → the enclave was wiped: recover the key
      //     through one of the two doors (password first, phrase as the
      //     forgot-password fallback — §7.5 Phase 0.5);
      //  3. no key + no sidecar → mint one.
      // An **Open** store skips all of it: no account, so no key exists and none
      // is made — the OS keychain is never touched.
      let dbKey =
        activeStore.custody === "protected" ? existingDbKey : undefined;
      let recoverySecret: Uint8Array | undefined;

      if (
        activeStore.custody === "protected" &&
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
              dbKey = openDbKeyWithPassword(passwordSidecar, answer.secret);
            } else if (
              answer.door === "phrase" &&
              recoverySidecar !== undefined
            ) {
              // Hold the recovery key: it is also this device's enclave copy,
              // restored below. A password unlock cannot recover it.
              recoverySecret = decodeRecoveryPhrase(answer.secret);
              dbKey = openDbKeyFromRecovery(recoverySidecar, recoverySecret);
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
      if (activeStore.custody === "protected" && dbKey === undefined)
        dbKey = await ensureDatabaseKey(keyStore);

      // The path is derived (§7.4), never a fixed `leapsake.db`. expo-sqlite
      // accepts the nested name and creates the directory — verified on device by
      // the custody self-test.
      const db = await SQLite.openDatabaseAsync(activeStore.path);
      const driver = expoSqliteDriver(db);
      // SQLCipher requires `PRAGMA key` to precede all DB access, so supply it as
      // the very first statement on the fresh connection, before migrations. An
      // Open store supplies none at all and opens as ordinary plaintext SQLite.
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
      // Custody Phase 0.5, not Phase 0: the master key is minted by account
      // creation, so an Open store runs the core with no key session at all.
      keySession.current =
        activeStore.custody === "protected"
          ? await ensureDeviceMasterKey({ keyStore, driver })
          : null;

      // Refresh the recovery sidecar to the *current* enclave recovery key on
      // every launch (not just when missing), so it stays in step if the key was
      // later adopted — e.g. after recovering an account. An Open store has no
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
          if (!status.enabled || status.relayUrl === undefined)
            return undefined;
          return runAccountSync({ driver, masterKey: session.masterKey });
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
        // optional, which is what lets an Open store run without one at all.
        createCore(driver, keySession.current ?? undefined),
        () => scheduler.current?.kick(),
      );
      coreRef.current = bootedCore;
      setCore(bootedCore);
      scheduler.current.start(); // backstop interval
      void regenerateSystemReminders(bootedCore); // birthdays atop Home
      void scheduler.current.autoTrigger(); // initial sync (skipped if auto off)
      /**
       * **Turn this device's Open store into an account's encrypted one** — the
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
       *   account id is not in scope and the store still lives at the Open path
       *   that this function is about to delete — so a writer resolving its own
       *   destination would put the door in the directory the flow then removes.
       *   Every caller captures the bytes instead and hands them here, where the
       *   converted store's own directory exists. Desktop does exactly this.
       * - **The recovery door needs no step at all**: the Protected boot path this
       *   ends by re-running seals it on every launch.
       *
       * Always ends by re-running the bootstrap, success *or* failure. On success it
       * resolves Protected and opens the converted store; on failure the roster is
       * untouched, so it resolves Open and re-opens the plaintext original the
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
          // A destination left by an earlier attempt that crashed before its roster
          // entry is claimed by nobody, so it is discardable — and clearing it is
          // what lets a retry convert into an empty file rather than trip the
          // converter's overwrite guard. Its doors go with it: they seal a key for
          // a store that is about to be replaced. Usually there is nothing there,
          // and `deleteDatabaseAsync` throws rather than shrugging at a missing
          // file, so tolerate that.
          if (!(await roster.list()).some((a) => a.id === accountId)) {
            try {
              await SQLite.deleteDatabaseAsync(target);
            } catch {
              // nothing stranded — the ordinary case
            }
            await targetDoors.destroy();
          }
          await convertStoreToEncrypted({
            fromName: activeStore.path,
            toName: target,
            key: dbKey,
          });
          // Beside the store it opens, and *before* the roster entry — so a device
          // that is Protected from the next boot onward has had both from the same
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
          // take on iOS. The Protected boot path this re-runs sweeps the leftover.
          try {
            await destroyPlaintextStore(activeStore.path);
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
         * exactly as it was — still Open, still plaintext, nothing on disk to
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
        // Creating an account is an **Open** device's act, as it is on desktop
        // (`create-account-flow.ts`). The converter would refuse the encrypted
        // source anyway, but only after an account had been registered on a
        // relay — so say so before anything leaves the device.
        if (activeStore.custody !== "open") {
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
          // it is the local act plus one step (model.md §7.2.1). The relay half
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
          const wasOpen = activeStore.custody === "open";
          // This device's own at-rest key, minted *before* the relay call: core
          // seals the password door from inside `joinAccountViaRelay`, and its
          // `sealPasswordDoorIfProtected` skips while there is no db-key to seal.
          // Minting first is what turns that skip into a real door, with no change
          // at the call site. Safe while Open — custody is decided purely by the
          // roster, and the Open boot branch ignores a db-key entirely.
          if (wasOpen) await ensureDatabaseKey(keyStore);
          // Capture the door core seals rather than letting it write: while this
          // runs the store is still the Open one, which the conversion below
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
            // Encrypt this device from byte one. The bootstrap this re-runs kicks
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
          // Already Protected: the store is where it belongs, so the freshly sealed
          // door belongs in its account's own directory.
          await writeThisDevicePasswordDoor(passwordDoor);
          void scheduler.current?.autoTrigger(); // push this device's data + pull remainder
          return { duplicateCount };
        },
        async recover({ username, recoveryPhrase, newPassword, relayUrl }) {
          if (newPassword.length < MIN_PASSWORD_LENGTH) {
            throw new Error(
              `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            );
          }
          const wasOpen = activeStore.custody === "open";
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
        // **Sign out** (model.md §7.3). Mobile has no relaunch primitive, so the
        // whole act is: forget the two keys that open this store, then re-run the
        // bootstrap. That re-run finds the roster still naming the account
        // (Protected) but no db-key, with both doors intact — which is exactly the
        // gate case above, so the unlock prompt raises itself. No new mechanism.
        //
        // The two guards mirror desktop's, and both refuse rather than repair:
        // an Open store has no account and no password to come back with, and a
        // device with no password door would be locked behind the 24-word phrase
        // alone, which is a support incident rather than a sign out.
        async signOut() {
          if ((await getSyncStatus({ driver })).enabled !== true) {
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
          const { enabled, username, relayUrl } = await getSyncStatus({
            driver,
          });
          if (enabled !== true) {
            throw new Error("There is no account on this device.");
          }
          const { durableBackup } = await fetchRelayCapabilities({ relayUrl });
          return { username, relayUrl, durableBackup };
        },
        // **Forget account** (model.md §7.3). The roster is the authority for
        // *which* store — it names it, and it is what the next bootstrap reads —
        // so with the entry gone the re-run resolves Open and lands the device on
        // a fresh plaintext store, the state a new install is in.
        async forgetAccount() {
          const accountId =
            activeStore.custody === "protected"
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
          // *Open* path — a plaintext store and no keys at all (model.md §7.2).
          //
          // Clearing the roster is what makes that true. Left behind, it would
          // send the next boot looking for the store of an account the user had
          // just erased and mint a fresh key over an empty encrypted database,
          // landing them back in a Protected state.
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
        // Reads, never mints. Minting here would give an accountless device a
        // keychain entry it is defined not to have (model.md §7.2) and show 24
        // words that unlock nothing — while Open there is no db-key to wrap and
        // no sidecar to open. Settings hides the surface until an account
        // exists; this refuses if it is ever reached another way.
        revealRecoveryPhrase: async () => {
          const recoveryKey = await readRecoveryKey(keyStore);
          if (recoveryKey === undefined) {
            // Two different absences (mirrors desktop). Signing out clears the
            // recovery key along with the db-key — both open the store — and a
            // *password* unlock cannot bring it back: it lived only in the
            // keychain that was cleared, and minting a replacement here would
            // re-seal the recovery sidecar under a fresh key and silently
            // invalidate the 24 words the user wrote down. Those words still
            // work; this device just can no longer display them.
            throw new Error(
              (await getSyncStatus({ driver })).enabled === true
                ? "This device can't show your recovery phrase again — it was " +
                    "cleared when you signed out. The phrase you saved still works."
                : "This device has no recovery phrase. Create an account to protect your data.",
            );
          }
          return encodeRecoveryPhrase(recoveryKey);
        },
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
          {children}
        </DataVersionContext.Provider>
      </SyncContext.Provider>
    </CoreContext.Provider>
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
        user signed out deliberately (model.md §7.3), or this device's secure
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
});
