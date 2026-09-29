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
  type CoreApi,
  type RecoveryDoorWriter,
  type SyncStatus,
  createCore,
  createLocalAccount,
  ensureLocalDeviceId,
  fetchRelayCapabilities,
  getSyncStatus,
  KEYSTORE_SECRET_IDS,
  lockThisDevice,
  MIN_PASSWORD_LENGTH,
  rotateRecoveryPhraseForAccount,
  type UnlockAnswer,
  type UnlockRequest,
  withSyncKick,
} from "@leapsake/core";
import {
  planNotifications,
  reconcile as reconcileNotificationSchedule,
} from "@leapsake/notifications";
import { addContactsChangeListener, getPermissionsAsync } from "expo-contacts";
import { syncDeviceContacts } from "./device-contacts-sync";
import { PasswordInput } from "../components/PasswordInput";
import { openActiveStore } from "./open-active-store";
import { useRecoveryGate } from "./use-recovery-gate";
import { createAccountRoster, storePath } from "@leapsake/store-layout";
import {
  clearUnclaimedDestination,
  convertStoreToEncrypted,
  destroyStoreFiles,
} from "../db/convert-store";
import { accountDoors } from "../db/doors";
import { openExpoStore } from "../db/open-store";
import { deleteAccountRoster, sqliteRosterStorage } from "../db/roster-storage";
import { secureStoreKeyStore } from "../keystore/secure-store-keystore";
import { forgetActiveAccount } from "./forget-active-account";
import {
  expoNotificationScheduler,
  PLATFORM_NOTIFICATION_BUDGET,
  type MobileNotificationScheduler,
} from "./notification-scheduler";

/** The account surface: custody acts, which are not transactional core ops. */
export interface AccountApi {
  status(): Promise<SyncStatus>;
  /** Create an account here, encrypting the store; returns the one-time phrase. */
  createAccount(args: {
    username: string;
    password: string;
  }): Promise<{ accountId: string; recoveryKey: string }>;
  /** Forget the keys that open the store and land on the unlock gate. */
  signOut(): Promise<void>;
  /** `durableBackup` is false unless something claims to keep a copy. */
  forgetInfo(): Promise<{
    username?: string;
    durableBackup: boolean;
  }>;
  /** Remove this account, its store and its doors from this device. */
  forgetAccount(): Promise<void>;
  /** Erase all local data and keys, then re-run the bootstrap as a fresh install. */
  factoryReset(): Promise<void>;
  /** Replace the recovery phrase, gated on the password; shown once. */
  rotateRecoveryPhrase(password: string): Promise<{ recoveryPhrase: string }>;
}

const CoreContext = createContext<CoreApi | null>(null);

const AccountContext = createContext<AccountApi | null>(null);
// Bumped when the provider changes rows behind a screen's back, so the focused
// screen re-reads. Without a provider it stays 0 and never invalidates.
const DataVersionContext = createContext(0);
/** Why this device cannot prove which master key is the account's. */
interface DegradedCustody {
  detail: string;
}
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

/** Add to a `useFocusedData` load's deps to re-read when the provider writes. */
export function useDataVersion(): number {
  return useContext(DataVersionContext);
}

/** This device's id. Throws if used outside a (loaded) CoreProvider. */
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
  // Set while the bootstrap waits on the unlock gate; `resolve` answers it, and
  // a wrong secret re-sets it with an `error`.
  const [recoveryPrompt, setRecoveryPrompt] = useState<{
    error?: string;
    doors: { password: boolean; phrase: boolean };
    resolve: (answer: UnlockAnswer) => void;
  } | null>(null);
  // Set by every bootstrap run, so a repaired device clears it by re-opening.
  // Unlike the prompt it does not block the app; it raises a standing banner.
  const [degraded, setDegraded] = useState<DegradedCustody | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  // Mirrors the `deviceId` ref, set at the same moment, for `useDeviceId()`.
  const [deviceIdState, setDeviceIdState] = useState<string | null>(null);
  // Bumping this re-runs the bootstrap in place after a store swap.
  const [resetVersion, setResetVersion] = useState(0);
  // The current core, for listeners set up once before any core is built.
  const coreRef = useRef<CoreApi | null>(null);
  const deviceId = useRef<string | null>(null);
  const notificationScheduler = useRef<MobileNotificationScheduler | null>(
    null,
  );
  if (notificationScheduler.current === null) {
    notificationScheduler.current = expoNotificationScheduler();
  }

  useEffect(() => {
    // Background work outlives its core when a store swap closes the driver,
    // which then throws; every closer replaces `coreRef` first, so check it.
    const isLiveCore = (coreApi: CoreApi) => coreRef.current === coreApi;

    // Best-effort, like the two below: a failure must never break the app.
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

    const reconcileNotifications = async (coreApi: CoreApi) => {
      const scheduler = notificationScheduler.current;
      const id = deviceId.current;
      if (scheduler === null || id === null) return;
      if (!isLiveCore(coreApi)) return;
      try {
        const [policy, reminders, pending] = await Promise.all([
          coreApi.notificationSettings.get(id),
          // Not `list`, which is windowed: the schedule reaches a year out,
          // since nothing advances it until the app is opened again.
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
        // Sequenced: each step reads what the one before it wrote.
        void bringInNewContacts(core)
          .then(() => regenerateSystemReminders(core))
          .then(() => reconcileNotifications(core));
      }
    });

    // Parks the bootstrap on the unlock gate until the user submits a secret.
    const requestUnlock = (request: UnlockRequest) =>
      new Promise<UnlockAnswer>((resolve) =>
        setRecoveryPrompt({ ...request, resolve }),
      );

    (async () => {
      const keyStore = secureStoreKeyStore();

      // Keychain only, so it is safe before custody is known; notifications
      // need it before their first reconcile.
      deviceId.current = await ensureLocalDeviceId(keyStore);
      setDeviceIdState(deviceId.current);

      const { activeStore, driver, doors, established } = await openActiveStore(
        {
          keyStore,
          listAccounts: () => createAccountRoster(sqliteRosterStorage()).list(),
          doorsFor: accountDoors,
          destroyStore: destroyStoreFiles,
          openStore: openExpoStore,
          ask: requestUnlock,
          onUnlocked: () => setRecoveryPrompt(null),
          platform: Platform.OS,
        },
      );
      // Degraded reports rather than throws: the store opens and a banner stays up.
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

      // Every mutating call reconciles this device's notifications.
      const buildCore = (): CoreApi =>
        withSyncKick(createCore(driver), () => {
          if (coreRef.current !== null) {
            void reconcileNotifications(coreRef.current);
          }
        });

      const bootedCore = buildCore();
      coreRef.current = bootedCore;
      setCore(bootedCore);
      // Sequenced: planning before the regenerate lands schedules off a stale
      // `dueDate`, a day wrong after a rollover or a milestone edit.
      void bringInNewContacts(bootedCore)
        .then(() => regenerateSystemReminders(bootedCore))
        .then(() => reconcileNotifications(bootedCore));
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
            // Swept on the next launch, by `openActiveStore`.
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
        async forgetAccount() {
          await forgetActiveAccount(activeStore, driver, {
            keyStore,
            roster: createAccountRoster(sqliteRosterStorage()),
            deleteStore: (name) => SQLite.deleteDatabaseAsync(name),
            doorsFor: accountDoors,
            onClosing: () => {
              setCore(null);
              setAccount(null);
            },
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
 * **The three `testID`s are load-bearing for Flow 4's door acts, not decoration**
 * (`plans/testing/crucial-flows.md` → Flow 4). Each is here because the visible
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
 * the inputs, the door flow found the password door's field and then could not find the
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
