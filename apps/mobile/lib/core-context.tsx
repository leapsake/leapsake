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
  /** Create an account, encrypting the store; returns the one-time phrase. */
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
  /** Erase all local data and keys, then boot again as a fresh install. */
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

/** Add to a `useFocusedData` load's deps to re-read after provider writes. */
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
      // Degraded reports rather than throws: the store opens under a banner.
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
       * Convert, write the password door, add the roster entry, then destroy
       * the original; always re-runs the bootstrap, which opens whichever won.
       */
      const adoptStoreForAccount = async (opts: {
        accountId: string;
        username: string;
        /** This device's at-rest key, minted by account creation. */
        dbKey: Uint8Array;
        /** `seal(db-key, KEK)`, captured from core, not written by it. */
        passwordDoor: Uint8Array;
      }) => {
        const { accountId, username, dbKey, passwordDoor } = opts;
        const roster = createAccountRoster(sqliteRosterStorage());
        const target = storePath(accountId);
        const targetDoors = accountDoors(accountId);
        await driver.close?.();
        try {
          await clearUnclaimedDestination({ accountId, roster });
          await convertStoreToEncrypted({
            fromName: activeStore.path,
            toName: target,
            key: dbKey,
          });
          // Before the roster entry, so an Authenticated device always has it.
          // Core cannot write it: the account's directory does not exist yet.
          await targetDoors.writePassword(passwordDoor);
          await roster.add({
            id: accountId,
            username,
            createdAt: new Date().toISOString(),
          });

          // The account now exists, so a throw would hide the one-time phrase.
          // The delete does not reliably take on iOS.
          try {
            await destroyStoreFiles(activeStore.path);
          } catch {
            // Swept on the next launch, by `openActiveStore`.
          }
        } finally {
          setResetVersion((v) => v + 1);
        }
      };

      /** Mints every key into the plaintext store, then converts it. */
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
        // The converter would refuse anyway; this names what is actually wrong.
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
        await adoptStoreForAccount({
          accountId,
          username,
          dbKey: newDbKey,
          passwordDoor: newPasswordSidecar,
        });
        return { accountId, recoveryKey: recoveryPhrase };
      };

      // Never runs mid-conversion, so `doors` is already the account's own.
      const writeThisDeviceRecoveryDoor: RecoveryDoorWriter = async (bytes) => {
        if (doors === undefined) {
          throw new Error(
            "This device has no account to seal a recovery door for.",
          );
        }
        await doors.writeRecovery(bytes);
      };

      setAccount({
        status: () => getSyncStatus({ driver }),
        createAccount: ({ username, password }) =>
          createAccountHere({ username, password }),
        // The re-run bootstrap finds an account with no db-key: the gate.
        // Refuses without a password door; the phrase alone is no way back.
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
          // Unmount first so the wiped core is never rendered.
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
 * The banner takes the top safe-area inset, and the app below gets a context
 * with none left, so its header does not pad for the notch a second time.
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

/** The Degraded notice; its way out is signing out to the unlock gate. */
function CustodyBanner({
  detail,
  onSignOut,
  insets,
}: {
  detail: string;
  onSignOut: () => Promise<void>;
  /** The safe area this banner owns; see {@link DegradedFrame}. */
  insets: { top: number; left: number; right: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  function signOut() {
    setSignOutError(null);
    // The gate takes over once the bootstrap re-runs, so only a refusal shows.
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
 * The boot-time unlock gate, leading with the password door. Its `testID`s
 * follow `maestro/README.md`: a multiline field's id goes on a wrapper.
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
      {/* A multiline field's return key cannot dismiss the keyboard, so a tap
          on the copy must, or the keyboard covers Unlock on a phone. */}
      <ScrollView
        contentContainerStyle={styles.gateContent}
        keyboardShouldPersistTaps="handled"
      >
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
  /** `flexGrow`: centred on a tall screen, scrolling on a short one. */
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
  gateLink: {
    marginTop: 16,
    textAlign: "center",
    textDecorationLine: "underline",
  },
  /** {@link DegradedFrame}: banner on top, the app filling the rest. */
  frame: {
    flex: 1,
  },
  frameBody: {
    flex: 1,
  },
  /** Top and side padding come from the safe area at render time. */
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
