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
  type CoreApi,
  type KeySession,
  type SyncScheduler,
  type SyncStatus,
  clearLocalAccount,
  createCore,
  createSyncScheduler,
  createLocalAccount,
  ensureDeviceMasterKey,
  getAutoSync,
  getSyncStatus,
  isRelayAuthError,
  joinAccountViaRelay,
  KEYSTORE_SECRET_IDS,
  lookupAccount,
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
  ensureRecoveryKey,
  openDbKeyFromRecovery,
  rawKeyLiteral,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import {
  createAccountRoster,
  resolveActiveStore,
  storePath,
} from "@leapsake/store-layout";
import {
  convertStoreToEncrypted,
  destroyPlaintextStore,
} from "../db/convert-store";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";
import { deleteAccountRoster, sqliteRosterStorage } from "../db/roster-storage";
import {
  deleteRecoverySidecar,
  readRecoverySidecar,
  writeRecoverySidecar,
} from "../db/recovery-sidecar";
import { secureStoreKeyStore } from "../keystore/secure-store-keystore";

/**
 * Mirror of the desktop main process's `MIN_PASSWORD_LENGTH` boundary check.
 * This password derives the encryption key for a zero-knowledge store with no
 * server-side reset, so the floor is deliberately higher than a typical login
 * (see security-review.md).
 */
const MIN_PASSWORD_LENGTH = 12;

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
   * key, adopt it under this device's enclave, and **swap the live core in
   * place** so every screen reads the adopted-MK core (the in-process analogue
   * of desktop's getter/`Proxy` core swap).
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
   * new password, adopt MK under this device's enclave, and swap the live core in.
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
   * Disconnect the account from this device: revoke the password + recovery
   * doors but keep the master key in the enclave, so local data stays readable.
   */
  clear(): Promise<void>;
  /**
   * Factory reset: erase all local data, the encryption keys, and the recovery
   * sidecar, then rebuild the app in place as a fresh install (there is no
   * relaunch primitive on mobile, so this re-runs the bootstrap). Unlike
   * {@link clear} — which keeps the data and master key — this is unrecoverable
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
  // The boot-time at-rest recovery prompt (model.md §6): set when this device's
  // enclave key is gone but the recovery sidecar survives, so the user must type
  // their phrase before the DB can open. `resolve` feeds the typed phrase back to
  // the awaiting bootstrap; a wrong phrase re-sets this with an `error`.
  const [recoveryPrompt, setRecoveryPrompt] = useState<{
    error?: string;
    resolve: (phrase: string) => void;
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

    // Park the bootstrap on the recovery gate until the user submits a phrase.
    const requestRecoveryPhrase = (attemptError?: string) =>
      new Promise<string>((resolve) =>
        setRecoveryPrompt({ error: attemptError, resolve }),
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
      const sidecar = await readRecoverySidecar();

      // At-rest encryption (Stage 2), now conditional on custody: a Protected
      // store's whole-DB key is held only in the OS enclave and the file is
      // ciphertext. Three cases (mirrors desktop's open.ts):
      //  1. enclave holds it → use it;
      //  2. no key + a recovery sidecar survives → the enclave was wiped: recover
      //     the key from the sidecar via the typed phrase (the only way back);
      //  3. no key + no sidecar → mint one.
      // An **Open** store skips all of it: no account, so no key exists and none
      // is made — the OS keychain is never touched.
      let dbKey =
        activeStore.custody === "protected" ? existingDbKey : undefined;
      let recoverySecret: Uint8Array | undefined;

      if (
        activeStore.custody === "protected" &&
        dbKey === undefined &&
        sidecar !== undefined
      ) {
        let attemptError: string | undefined;
        for (;;) {
          const phrase = await requestRecoveryPhrase(attemptError);
          try {
            recoverySecret = decodeRecoveryPhrase(phrase);
            dbKey = openDbKeyFromRecovery(sidecar, recoverySecret);
            break;
          } catch {
            recoverySecret = undefined;
            attemptError = "That recovery phrase doesn't open this database.";
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
      if (dbKey !== undefined)
        await driver.exec(`PRAGMA key = "${rawKeyLiteral(dbKey)}"`);
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
      if (dbKey !== undefined) {
        if (recoverySecret === undefined)
          recoverySecret = await ensureRecoveryKey(keyStore);
        else await keyStore.setSecret(RECOVERY_KEY, recoverySecret);
        await writeRecoverySidecar(sealDbKeyForRecovery(dbKey, recoverySecret));
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
        async enable({ username, password, relayUrl }) {
          if (password.length < MIN_PASSWORD_LENGTH) {
            throw new Error(
              `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            );
          }
          // Enabling sync **is** creating an account that also binds a relay, so
          // it runs the full flow (model.md §7.2.1): mint the keys, publish to the
          // relay, then convert this device's plaintext store to encrypted. Before
          // this it created the account and left the store plaintext — a
          // half-Protected state §7.2 does not have.
          const { accountId, recoveryPhrase, dbKey, bootstrap } =
            await createLocalAccount({
              keyStore,
              driver,
              password,
              username,
              relayUrl,
              platform: Platform.OS,
            });
          try {
            await registerAccountWithRelay({ relayUrl, bootstrap });
          } catch (cause) {
            // Don't leave a half-enabled account behind if the relay rejects it.
            // Nothing on disk has moved yet, so this restores the exact prior state.
            await clearLocalAccount({ driver });
            throw new Error(relayErrorMessage(cause, relayUrl), { cause });
          }

          // The irreversible half, in the order that survives a crash at any
          // point: convert (original kept) → roster → destroy the original.
          scheduler.current?.stop();
          await driver.close?.();
          await convertStoreToEncrypted({
            fromName: activeStore.path,
            toName: storePath(accountId),
            key: dbKey,
          });
          await createAccountRoster(sqliteRosterStorage()).add({
            id: accountId,
            username,
            createdAt: new Date().toISOString(),
          });
          await destroyPlaintextStore(activeStore.path);

          // The store this bootstrap opened no longer exists; re-run the effect so
          // every screen ends up on the encrypted one (the same in-place restart
          // factory reset uses, since mobile has no relaunch primitive).
          setResetVersion((v) => v + 1);
          return { accountId, recoveryKey: recoveryPhrase };
        },
        async join({ username, password, relayUrl }) {
          let session: KeySession;
          try {
            session = await joinAccountViaRelay({
              keyStore,
              driver,
              relayUrl,
              username,
              password,
              platform: Platform.OS,
            });
          } catch (cause) {
            throw new Error(relayErrorMessage(cause, relayUrl), { cause });
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
          void scheduler.current?.autoTrigger(); // push this device's data + pull remainder
          return { duplicateCount };
        },
        async recover({ username, recoveryPhrase, newPassword, relayUrl }) {
          if (newPassword.length < MIN_PASSWORD_LENGTH) {
            throw new Error(
              `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            );
          }
          let session: KeySession;
          try {
            session = await recoverAccountViaRelay({
              keyStore,
              driver,
              relayUrl,
              username,
              recoveryPhrase,
              newPassword,
              platform: Platform.OS,
            });
          } catch (cause) {
            throw new Error(relayErrorMessage(cause, relayUrl), { cause });
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
            await reauthenticateViaRelay({ keyStore, driver, password });
          } catch (cause) {
            throw new Error(relayErrorMessage(cause, relayUrl ?? ""), {
              cause,
            });
          }
          await scheduler.current?.trigger();
        },
        clear: () => clearLocalAccount({ driver }),
        async factoryReset() {
          // Show the loading state first so the wiped core is never rendered,
          // then tear everything down: stop background sync, close the DB handle,
          // delete the store + recovery sidecar + account roster, and clear every
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
          await deleteRecoverySidecar();
          await deleteAccountRoster();
          for (const id of KEYSTORE_SECRET_IDS) {
            await keyStore.deleteSecret(id);
          }
          keySession.current = null;
          coreRef.current = null;
          setResetVersion((v) => v + 1);
        },
        revealRecoveryPhrase: async () =>
          encodeRecoveryPhrase(await ensureRecoveryKey(keyStore)),
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
 * The boot-time at-rest recovery prompt (encryption `model.md` §6), the mobile
 * counterpart to desktop's `RecoveryGate`. Shown before the app loads when the
 * enclave key is missing but the recovery sidecar survives; the typed phrase is
 * fed back to the awaiting bootstrap, which unwraps the whole-DB key and reopens
 * the file. A wrong phrase comes back as `error`, re-enabling the form.
 */
function RecoveryGate({
  error,
  onSubmit,
}: {
  error?: string;
  onSubmit: (phrase: string) => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // A new error means the last attempt failed — let the user try again.
  useEffect(() => {
    if (error !== undefined) setSubmitting(false);
  }, [error]);

  function submit() {
    if (phrase.trim() === "") return;
    setSubmitting(true);
    onSubmit(phrase);
  }

  return (
    <View style={styles.gate}>
      <Text style={styles.gateTitle}>Restore access to your data</Text>
      <Text style={styles.gateBody}>
        This device's key is missing — its secure storage was likely reset — but
        your encrypted data is still here. Enter your recovery phrase to unlock
        it.
      </Text>
      <TextInput
        value={phrase}
        onChangeText={setPhrase}
        editable={!submitting}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Enter your 24-word recovery phrase…"
        style={styles.gateInput}
      />
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
});
