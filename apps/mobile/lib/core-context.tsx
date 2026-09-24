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
  ScrollView,
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
  type AdoptionDoor,
  type CoreApi,
  type RecoveryDoorWriter,
  type SyncStatus,
  createCore,
  createLocalAccount,
  ensureLocalDeviceId,
  establishKeySession,
  fetchRelayCapabilities,
  getSyncStatus,
  KEYSTORE_SECRET_IDS,
  lockThisDevice,
  MIN_PASSWORD_LENGTH,
  rotateRecoveryPhraseForAccount,
  runMigrations,
  seedHolidayCatalog,
  type UnlockAnswer,
  type UnlockRequest,
  unlockStore,
  withSyncKick,
} from "@leapsake/core";
import {
  DATABASE_KEY,
  RECOVERY_KEY,
  ensureDatabaseKey,
  rawKeyLiteral,
  readRecoveryKey,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import {
  planNotifications,
  reconcile as reconcileNotificationSchedule,
} from "@leapsake/notifications";
import { addContactsChangeListener, getPermissionsAsync } from "expo-contacts";
import { syncDeviceContacts } from "./device-contacts-sync";
import { PasswordInput } from "../components/PasswordInput";
import { useRecoveryGate } from "./use-recovery-gate";
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
import {
  expoNotificationScheduler,
  PLATFORM_NOTIFICATION_BUDGET,
  type MobileNotificationScheduler,
} from "./notification-scheduler";

/**
 * The account surface (custody Phase 1). Kept deliberately separate from
 * {@link CoreApi}: creating an account isn't a transactional core op, so —
 * exactly like desktop's separate `window.account` bridge (not folded into
 * `window.api`) — it lives in its own context rather than on the core.
 */
export interface AccountApi {
  status(): Promise<SyncStatus>;
  /**
   * **Create an account on this device** (`model.md` §7.2.1) — the act that
   * turns encryption on: nothing leaves the phone. Under *encryption follows
   * custody* an account is the only thing that encrypts the store, so without
   * this the store would stay plaintext forever.
   *
   * Returns the one-time recovery phrase for its single reveal.
   */
  createAccount(args: {
    username: string;
    password: string;
  }): Promise<{ accountId: string; recoveryKey: string }>;
  /**
   * **Sign out** (`model.md` §7.3): close the store and forget the keys that open
   * it, so the password is needed to get back in. The data stays on this device,
   * encrypted — {@link AccountApi.forgetAccount} is the one that removes it. Rebuilds
   * in place, landing on the unlock gate the bootstrap already hosts.
   */
  signOut(): Promise<void>;
  /**
   * What the Forget-account confirmation needs to word itself (`model.md`
   * §7.3.1). `durableBackup` is whether anything claims to keep a copy — `false`
   * whenever nobody said otherwise, which is what makes forgetting the last
   * device read as the deletion it is.
   */
  forgetInfo(): Promise<{
    username?: string;
    durableBackup: boolean;
  }>;
  /**
   * **Forget account** (`model.md` §7.3): remove this account, its store, and its
   * unlock doors from this device, leaving it in the accountless state a fresh
   * install is in.
   */
  forgetAccount(): Promise<void>;
  /**
   * Factory reset: erase all local data, the encryption keys, and the recovery
   * sidecar, then rebuild the app in place as a fresh install (there is no
   * relaunch primitive on mobile, so this re-runs the bootstrap). Unrecoverable.
   */
  factoryReset(): Promise<void>;
  /**
   * Replace this device's recovery phrase, gated on the account password
   * (`model.md` §6). Returns the new phrase to show **once** — there is no way to
   * see it again.
   */
  rotateRecoveryPhrase(password: string): Promise<{ recoveryPhrase: string }>;
}

// Build the core exactly once for the whole app and share it through context.
// This is the multi-screen successor to the proof screen's per-effect bootstrap
// (old App.tsx): open the on-device SQLite file, run the shared migrations on
// expo-sqlite, then `createCore`. Every screen reads the ready CoreApi via
// `useCore()` and calls it in-process — no IPC, unlike desktop.
const CoreContext = createContext<CoreApi | null>(null);

const AccountContext = createContext<AccountApi | null>(null);
// A monotonically-increasing counter bumped whenever the provider changes rows
// behind a screen's back. `useFocusedData` depends on it, so a bump re-runs the
// focused screen's load — the in-process analogue of desktop's
// `router.revalidate()` (reactive invalidation). Defaults to 0 (no provider →
// never invalidates, so a screen used outside CoreProvider still renders).
const DataVersionContext = createContext(0);
/** The *Degraded* state as a screen needs it: why this device cannot prove which
 *  master key is the account's (see {@link CustodyBanner}). */
interface DegradedCustody {
  detail: string;
}
// This device's stable id (Inc 1, `ensureLocalDeviceId`) — the state mirror
// of `CoreProvider`'s `deviceId` ref, so a screen (the notification settings
// section, §7) can address `notificationSettings.setPolicy`/`get` for *this*
// device without reaching into a ref.
const DeviceIdContext = createContext<string | null>(null);

/** Access the ready CoreApi. Throws if used outside a (loaded) CoreProvider. */
export function useCore(): CoreApi {
  const core = useContext(CoreContext);
  if (core === null) {
    throw new Error("useCore must be used within a CoreProvider");
  }
  return core;
}

/** Access the account surface. Throws if used outside a CoreProvider. */
export function useAccount(): AccountApi {
  const account = useContext(AccountContext);
  if (account === null) {
    throw new Error("useAccount must be used within a CoreProvider");
  }
  return account;
}

/**
 * The reactive-invalidation signal: a counter that bumps when the provider
 * changed rows itself — new phone contacts, regenerated birthday reminders. Add
 * it to a `useFocusedData` load's deps so the focused screen re-reads.
 */
export function useDataVersion(): number {
  return useContext(DataVersionContext);
}

/**
 * This device's id (Inc 1). Throws if used outside a (loaded) CoreProvider,
 * like {@link useCore} — by the time `core` is non-null the boot effect has
 * already minted or read it, so the two never disagree.
 */
export function useDeviceId(): string {
  const deviceId = useContext(DeviceIdContext);
  if (deviceId === null) {
    throw new Error("useDeviceId must be used within a CoreProvider");
  }
  return deviceId;
}

export function CoreProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<CoreApi | null>(null);
  const [account, setAccount] = useState<AccountApi | null>(null);
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
  // raises a standing banner.
  const [degraded, setDegraded] = useState<DegradedCustody | null>(null);
  // Reactive invalidation: bumped whenever something outside the focused screen
  // changed rows, so it (via `useFocusedData` → `useDataVersion`) re-reads.
  const [dataVersion, setDataVersion] = useState(0);
  // The state mirror of the `deviceId` ref below (Inc 1) — set at the same
  // point, so a screen (the notification settings section, §7) can read this
  // device's id via `useDeviceId()` without reaching into a ref.
  const [deviceIdState, setDeviceIdState] = useState<string | null>(null);
  // Bumped by a factory reset to re-run the bootstrap effect after the data +
  // keys have been wiped, so the app re-mints a fresh key over an empty DB in
  // place — the mobile stand-in for desktop's process relaunch.
  const [resetVersion, setResetVersion] = useState(0);
  // The live core, mirrored in a ref so the AppState (foreground) listener — set
  // up once, before the core is built — can reach the *current* core (which a
  // later join/recover swaps) to regenerate system reminders on foreground.
  const coreRef = useRef<CoreApi | null>(null);
  // This device's stable id (`ensureLocalDeviceId`) — minted once at boot,
  // independent of any account, and read back unchanged after. Keys the
  // `notification_settings` row this device's own reconcile and (eventually)
  // its settings screen address.
  const deviceId = useRef<string | null>(null);
  // The OS-backed notification scheduler port (Inc 3 §3's
  // `expo-notifications` adapter) — stateless, so it's built once here
  // (lazily, the manual `useRef` equivalent of `useState`'s lazy initializer)
  // rather than inside the boot effect, which only runs once per boot/reset
  // but this doesn't need to wait for.
  const notificationScheduler = useRef<MobileNotificationScheduler | null>(
    null,
  );
  if (notificationScheduler.current === null) {
    notificationScheduler.current = expoNotificationScheduler();
  }

  useEffect(() => {
    /**
     * Is this core still the live one?
     *
     * **Both reconciles below outlive the core they were handed.** They are
     * fired-and-forgotten at boot, on foreground, and after every write, and
     * each awaits several round trips to SQLite — while a factory reset,
     * forget-account, join or recover can close that driver and swap the core
     * mid-flight. What the old core then throws is
     * `ERR_ACCESS_CLOSED_RESOURCE` ("Call to function
     * 'NativeDatabase.prepareAsync' has been rejected → Access to closed
     * resource"), and the `catch`es below used to report it as a failure.
     *
     * It is not one — the work was simply cancelled — and reporting it costs
     * more than noise: on a dev client every `console.error` raises a LogBox
     * banner across the bottom of the screen, exactly where the tab bar is, so
     * a reset that worked perfectly leaves the app looking broken and the tab
     * bar unhittable. That is how it was found (Flow 1, Android, 2026-08-31):
     * the erase succeeded and the flow died on `tab-search is not visible`.
     *
     * The identity check is the whole test, because every path that closes a
     * driver nulls or replaces `coreRef.current` in the same breath, before
     * awaiting anything. Checked *before* starting (nothing to do) and again in
     * the `catch` (the teardown happened mid-flight), and it guards the writes
     * too: a stale reconcile must not bump `dataVersion` for a store that is
     * gone.
     */
    const isLiveCore = (coreApi: CoreApi) => coreRef.current === coreApi;

    /**
     * Reconcile automated (`system`) reminders — upcoming birthdays — against the
     * given core, then, only if anything changed, bump the data version so the
     * focused screen re-reads. Runs at boot and on foreground (a new local day
     * can bring a birthday into range). Best-effort: a failure must never break
     * the app.
     */
    const regenerateSystemReminders = async (coreApi: CoreApi) => {
      if (!isLiveCore(coreApi)) return;
      try {
        const { created, updated, removed } =
          await coreApi.reminders.regenerateSystem();
        if (!isLiveCore(coreApi)) return;
        if (created > 0 || updated > 0 || removed > 0) {
          setDataVersion((v) => v + 1);
        }
      } catch (cause) {
        if (!isLiveCore(coreApi)) return; // torn down mid-flight, not a failure
        console.error("regenerate system reminders failed:", cause);
      }
    };

    /**
     * The second reconcile, one layer out: compute this device's desired
     * OS notifications from its policy + the live reminder set
     * (`@leapsake/notifications`' `planNotifications`), diff against what the
     * OS actually has pending, and drive the scheduler port through the delta
     * (`reconcileNotificationSchedule`). Same triggers as
     * `regenerateSystemReminders` above — boot, foreground — plus every
     * mutating `CoreApi` call, via `buildCore`'s second `withSyncKick` layer
     * below (the "kick after every write" mechanism from `@leapsake/sync`),
     * so completion, snooze, milestone edits, and this device's own policy
     * changes all reconcile without a bespoke call at each site.
     *
     * `deviceId.current` is `null` only in the brief window before boot mints
     * it (§1); every other caller runs after. Best-effort throughout, like
     * `regenerateSystemReminders` above.
     */
    const reconcileNotifications = async (coreApi: CoreApi) => {
      const scheduler = notificationScheduler.current;
      const id = deviceId.current;
      if (scheduler === null || id === null) return;
      if (!isLiveCore(coreApi)) return;
      try {
        const [policy, reminders, pending] = await Promise.all([
          coreApi.notificationSettings.get(id),
          // `listNotifiable`, not `list`: the reminder *list* deliberately
          // shows only what each action's own window puts on display, while
          // the schedule has to reach a year out — nothing else advances it
          // until the app is opened again.
          coreApi.reminders.listNotifiable(),
          scheduler.listPending(),
        ]);
        if (policy === undefined || !isLiveCore(coreApi)) return;
        const desired = planNotifications(reminders, policy, Date.now(), {
          budget: PLATFORM_NOTIFICATION_BUDGET,
        });
        await reconcileNotificationSchedule(desired, pending, scheduler);
      } catch (cause) {
        if (!isLiveCore(coreApi)) return; // torn down mid-flight, not a failure
        console.error("notification reconcile failed:", cause);
      }
    };

    /**
     * Bring in any phone contact this device has not seen, once the user has
     * switched that on by importing (`lib/device-contacts-sync.ts`, which has
     * the rules). Runs ahead of the two reconciles above at boot and on
     * foreground, so a new contact's birthday reaches Home and the OS schedule
     * in the same pass rather than the next one. Best-effort, like them.
     */
    const bringInNewContacts = async (coreApi: CoreApi) => {
      if (!isLiveCore(coreApi)) return;
      try {
        const result = await syncDeviceContacts(coreApi);
        if (!isLiveCore(coreApi)) return;
        if (result !== null && result.created > 0) {
          setDataVersion((v) => v + 1);
        }
      } catch (cause) {
        if (!isLiveCore(coreApi)) return; // torn down mid-flight, not a failure
        console.error("contacts sync failed:", cause);
      }
    };

    // A contact added while the app is open — typed on another device and
    // arriving over iCloud, say — should not wait for the next foreground. The
    // new contact's own commit reconciles reminders, so this needs neither of
    // the reconciles above.
    //
    // Android rejects the observer without READ_CONTACTS, so it attaches only
    // once permission exists and retries on each foreground.
    let contactsSub: ReturnType<typeof addContactsChangeListener> | null = null;
    let unwatched = false;
    const watchContacts = async () => {
      if (contactsSub !== null || unwatched) return;
      if (!(await getPermissionsAsync()).granted) return;
      if (unwatched) return; // torn down while the permission was being read
      contactsSub = addContactsChangeListener(() => {
        if (coreRef.current !== null) void bringInNewContacts(coreRef.current);
      });
    };
    void watchContacts();

    // Catch up on what changed while the app was away.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void watchContacts();
      if (coreRef.current !== null) {
        const core = coreRef.current;
        // Sequenced, not parallel `void`s: `reconcileNotifications` reads
        // `reminders.list()` fresh, so it must not race the regenerate write
        // below — see the boot-time pairing's comment for the bug this fixes.
        void bringInNewContacts(core)
          .then(() => regenerateSystemReminders(core))
          .then(() => reconcileNotifications(core));
      }
    });

    // Park the bootstrap on the unlock gate until the user submits a secret. The
    // gate is told which doors this store has, so it can lead with the password
    // and only offer the phrase as the forgot-password fallback (§7.5).
    const requestUnlock = (request: UnlockRequest) =>
      new Promise<UnlockAnswer>((resolve) =>
        setRecoveryPrompt({ ...request, resolve }),
      );

    (async () => {
      // The same keystore instance that backs the account surface below.
      const keyStore = secureStoreKeyStore();

      // Mint-or-read this device's stable id (Inc 1) — touches only the OS
      // keychain, so it's safe before custody state is even known, and must
      // be ready before the first `reconcileNotifications` call below. The
      // state mirror follows in the same tick so `useDeviceId()` and this ref
      // never disagree.
      deviceId.current = await ensureLocalDeviceId(keyStore);
      setDeviceIdState(deviceId.current);

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
        const unlocked = await unlockStore(
          { password: passwordSidecar, phrase: recoverySidecar },
          requestUnlock,
        );
        dbKey = unlocked.dbKey;
        unlockedBy = unlocked.door;
        // A phrase unlock also restores this device's recovery key, below.
        if (unlocked.door.kind === "recovery") {
          recoverySecret = unlocked.door.recoveryKey;
        }
        await keyStore.setSecret(DATABASE_KEY, dbKey);
        setRecoveryPrompt(null);
      }
      if (activeStore.custody === "encrypted" && dbKey === undefined)
        dbKey = await ensureDatabaseKey(keyStore);

      // The path is derived (§7.4), never a fixed `leapsake.db`. expo-sqlite
      // accepts the nested name and creates the directory — verified on device by
      // the custody self-test.
      const db = await SQLite.openDatabaseAsync(activeStore.path, {
        useNewConnection: true,
      });
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
      // is the account's is *Degraded*: the store opens and every screen works, and
      // the banner stays up until the repair lands.
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
      setDegraded(
        established.state === "degraded"
          ? { detail: established.message }
          : null,
      );
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

      // Wrap a freshly created core so every mutating call reconciles this
      // device's local notifications (Inc 3 §6). `withSyncKick` is the
      // "kick after every mutation" wrapper from `@leapsake/sync`, reused here
      // rather than threading a new port through `@leapsake/core`.
      // `reconcileNotifications` reads `coreRef.current` rather than closing
      // over the core being built here, since that ref is set synchronously
      // right after, before anything can call into the wrapped object.
      const buildCore = (): CoreApi =>
        withSyncKick(createCore(driver), () => {
          if (coreRef.current !== null) {
            void reconcileNotifications(coreRef.current);
          }
        });

      const bootedCore = buildCore();
      coreRef.current = bootedCore;
      setCore(bootedCore);
      // Sequenced: `reconcileNotifications` reads `reminders.list()` fresh, so
      // it must run after the regenerate write lands, not racing it — a boot
      // right after a milestone edit or a day rollover would otherwise plan
      // off the pre-regenerate `dueDate` and schedule a day off.
      void bringInNewContacts(bootedCore)
        .then(() => regenerateSystemReminders(bootedCore))
        .then(() => reconcileNotifications(bootedCore)); // new contacts, birthdays atop Home, then the second reconcile, one layer out
      /**
       * **Turn this device's Unauthenticated store into an account's encrypted one** — the
       * irreversible half of creating an account here (§7.2.1):
       *
       * > **convert (original kept) → password door → roster entry → destroy the
       * > original.**
       *
       * The order is chosen for what a crash *between* two steps leaves behind (the
       * table in `db/convert-store.ts`), and it matches desktop's
       * `create-account-flow.ts` step for step. Two things about it are
       * load-bearing:
       *
       * - **The password door is written here, not by core.** Core seals it from
       *   inside `createLocalAccount`, at a moment when the
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
        /** This device's at-rest key, minted by account creation. */
        dbKey: Uint8Array;
        /** `seal(db-key, KEK)`, captured from core rather than written by it. */
        passwordDoor: Uint8Array;
      }) => {
        const { accountId, username, dbKey, passwordDoor } = opts;
        const roster = createAccountRoster(sqliteRosterStorage());
        const target = storePath(accountId);
        const targetDoors = accountDoors(accountId);
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
       * store, then hands the irreversible half to
       * {@link adoptStoreForAccount}.
       */
      const createAccountHere = async (opts: {
        username: string;
        password: string;
      }): Promise<{ accountId: string; recoveryKey: string }> => {
        const { username, password } = opts;
        if (password.length < MIN_PASSWORD_LENGTH) {
          throw new Error(
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
          );
        }
        // Creating an account is an **Unauthenticated** device's act, as it is on desktop
        // (`create-account-flow.ts`). The converter would refuse the encrypted
        // source anyway; saying so here names what is actually wrong.
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
        } = await createLocalAccount({
          keyStore,
          driver,
          password,
          username,
          platform: Platform.OS,
        });
        // The irreversible half. It re-runs the bootstrap on its way out (the
        // store this one opened no longer exists), which is also how a failure
        // mid-conversion lands back on the plaintext original rather than on a
        // closed driver.
        await adoptStoreForAccount({
          accountId,
          username,
          dbKey: newDbKey,
          passwordDoor: newPasswordSidecar,
        });
        return { accountId, recoveryKey: recoveryPhrase };
      };

      /**
       * The {@link RecoveryDoorWriter} for rotating this device's recovery
       * phrase. It never runs during a store conversion, so `doors` already
       * names the account's own directory whenever it can be reached.
       */
      const writeThisDeviceRecoveryDoor: RecoveryDoorWriter = async (bytes) => {
        if (doors === undefined) {
          throw new Error(
            "This device has no account to seal a recovery door for.",
          );
        }
        await doors.writeRecovery(bytes);
      };

      // The account surface closes over the *booted* driver + keystore, so it
      // never re-opens the DB or re-creates the keystore (custody Phase 1).
      setAccount({
        status: () => getSyncStatus({ driver }),
        createAccount: ({ username, password }) =>
          createAccountHere({ username, password }),
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
          setAccount(null);
          await driver.close?.();
          await lockThisDevice({ keyStore });
          coreRef.current = null;
          setResetVersion((v) => v + 1);
        },
        async forgetInfo() {
          const { hasAccount, username } = await getSyncStatus({ driver });
          if (hasAccount !== true) {
            throw new Error("There is no account on this device.");
          }
          const { durableBackup } = await fetchRelayCapabilities({});
          return { username, durableBackup };
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
          setAccount(null);
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
          coreRef.current = null;
          setResetVersion((v) => v + 1);
        },
        async factoryReset() {
          // Show the loading state first so the wiped core is never rendered,
          // then tear everything down: close the DB handle, delete this store,
          // its doors and the account roster, and clear every keystore secret.
          // Bumping resetVersion re-runs the bootstrap effect, which now finds no
          // roster, no key and no store, and so takes the *Unauthenticated* path
          // — a plaintext store and no keys at all (@leapsake/key-custody).
          //
          // Clearing the roster is what makes that true. Left behind, it would
          // send the next boot looking for the store of an account the user had
          // just erased and mint a fresh key over an empty encrypted database,
          // landing them back in an Authenticated state.
          setCore(null);
          setAccount(null);
          await driver.close?.();
          await SQLite.deleteDatabaseAsync(activeStore.path);
          await doors?.destroy();
          await deleteAccountRoster();
          for (const id of KEYSTORE_SECRET_IDS) {
            await keyStore.deleteSecret(id);
          }
          coreRef.current = null;
          setResetVersion((v) => v + 1);
        },
        // Replaces this device's phrase rather than revealing it (mirroring
        // desktop): a phrase is shown once at account creation, and rotation is
        // the only later route to one. Gated on the password, checked locally by
        // core, so it works offline.
        rotateRecoveryPhrase: (password) =>
          rotateRecoveryPhraseForAccount({
            keyStore,
            driver,
            password,
            writeRecoveryDoor: writeThisDeviceRecoveryDoor,
          }),
      });
    })().catch((e) => setError(String(e)));

    return () => {
      unwatched = true;
      appStateSub.remove();
      contactsSub?.remove();
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

  if (core === null || account === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <CoreContext.Provider value={core}>
      <AccountContext.Provider value={account}>
        <DataVersionContext.Provider value={dataVersion}>
          <DeviceIdContext.Provider value={deviceIdState}>
            {degraded === null ? (
              children
            ) : (
              <DegradedFrame
                degraded={degraded}
                onSignOut={() => account.signOut()}
              >
                {children}
              </DegradedFrame>
            )}
          </DeviceIdContext.Provider>
        </DataVersionContext.Provider>
      </AccountContext.Provider>
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
 * The **Degraded** state's standing notice (encryption `model.md` §7.5), the
 * mobile counterpart of desktop's `CustodyBanner`: this device's store opened and
 * every screen works, but the device cannot prove which master key belongs to the
 * account until that is repaired.
 *
 * A banner rather than a gate, deliberately. The cause is invisible to the person it
 * happens to — a restored phone, a reinstall, a changed signing identity — and their
 * data is on the device and readable, so refusing to open the app punishes them for
 * something they cannot see or act on.
 *
 * **The way out is the unlock gate.** Signing out re-runs the bootstrap into that
 * gate, where the *other* door is one tap away — a phrase door is untouched by a
 * broken password door and vice versa — and the next open re-runs the repair with it.
 */
function CustodyBanner({
  detail,
  onSignOut,
  insets,
}: {
  detail: string;
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
        ⚠ This device needs to be re-linked to your account.
      </Text>
      <Text style={styles.bannerBody}>
        Your data is safe and still here. Nothing is lost — but until you
        re-link it, this device can't confirm that it holds your account's key.
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
 *
 * **The three `testID`s are load-bearing for Flow 7c, not decoration**
 * (`plans/testing/crucial-flows.md` → Flow 7). Each is here because the visible
 * text cannot carry the assertion:
 *
 * - `recovery-gate` — this `View` has no text of its own, and it is what a flow
 *   waits on after a relaunch to know which of the two boots it got.
 * - `recovery-secret` — the password field is `secureTextEntry` and so has empty
 *   accessibility text, the case `../maestro/README.md` → *A secure field needs a
 *   `testID`* documents, where a tap by text or point reports COMPLETED and types
 *   into nothing. Only one field is mounted at a time, so one id serves both
 *   doors; a flow says which door it is on by the visible label beside it.
 *
 * **`recovery-secret` sits on a wrapping `View`, not on the `TextInput`, and it has
 * to.** A `multiline` `TextInput` is a `UITextView` on iOS, and the node XCUITest
 * surfaces for it carries **no accessibility identifier** — the driver sees a scroll
 * view with two scroll bars and nothing else. Measured 2026-09-09: with the id on
 * the inputs, Flow 7c found the password door's field and then could not find the
 * phrase door's *at all*, while the screenshot showed it rendering perfectly. A
 * plain `View` does carry its id (`recovery-gate` above is one), it wraps the field
 * tightly, so a tap at its centre lands on the field and focuses it. Putting the id
 * on both wrappers rather than only the phrase one keeps the two doors symmetric —
 * a flow does the same thing on each.
 * - `recovery-submit` — the button's label is "Unlock" and this screen's title is
 *   "Unlock your data", which a selector would match too, and the label flips to
 *   "Checking…" mid-submit.
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
  const { door, secret, setSecret, submitting, shownError, submit, switchTo } =
    useRecoveryGate({ error, doors, onSubmit });

  return (
    <View testID="recovery-gate" style={styles.gate}>
      {/*
        **The scroller is what makes the phrase door usable at all**, and it is
        not a harness accommodation. On the phrase door the field is `multiline`,
        so its return key inserts a newline instead of dismissing; inside a plain
        `View` a tap elsewhere does not blur either, and the software keyboard
        covers **Unlock** on a phone-sized screen. Measured on an iPhone 16 Pro,
        2026-09-09: field at y419-507, Unlock at y520-565, keyboard from ~538 —
        so someone who has just been locked out, and who has correctly reached
        for their 24 words, types them and then cannot press the button.
        `keyboardShouldPersistTaps="handled"` restores the ordinary escape (a tap
        on any non-touchable — the title, the body copy — puts the keyboard away)
        and the scroll gives the button somewhere to go on a short screen.

        `recovery-gate` stays on the `View` outside it rather than moving onto the
        `ScrollView`: a scroll view is the one node kind this screen has already
        been bitten by — see the `recovery-secret` note above — and the anchor is
        not worth risking for one less element.
      */}
      <ScrollView
        contentContainerStyle={styles.gateContent}
        keyboardShouldPersistTaps="handled"
      >
        {/*
          Names no cause, because this gate now has two (mirrors desktop's): the
          user signed out deliberately (@leapsake/key-custody), or this device's
          secure storage was reset and took the key with it. Asserting the second
          — as this used to — reads as an alarming malfunction to someone who
          simply signed out a moment ago.
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
          <>
            <Text style={styles.gateFieldLabel}>Password</Text>
            <View testID="recovery-secret">
              <PasswordInput
                value={secret}
                onChangeText={setSecret}
                editable={!submitting}
                style={styles.gateInput}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.gateFieldLabel}>Recovery phrase</Text>
            <View testID="recovery-secret">
              <TextInput
                value={secret}
                onChangeText={setSecret}
                editable={!submitting}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.gateInput}
              />
            </View>
          </>
        )}
        {shownError !== undefined && (
          <Text style={styles.error}>{shownError}</Text>
        )}
        <Pressable
          testID="recovery-submit"
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
      </ScrollView>
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
  },
  /** `flexGrow` rather than `flex`, so the content still centres on a tall screen
   *  and simply scrolls once the keyboard has taken half of a short one. */
  gateContent: {
    flexGrow: 1,
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
  gateFieldLabel: {
    fontSize: 13,
    color: "#6b6b6b",
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
