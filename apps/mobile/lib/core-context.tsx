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
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as SQLite from "expo-sqlite";
import {
  type CoreApi,
  type KeySession,
  type SyncStatus,
  clearLocalAccount,
  createCore,
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
  joinAccountViaRelay,
  lookupAccount,
  registerAccountWithRelay,
  runAccountSync,
  runMigrations,
} from "@leapsake/core";
import { bytesToBase64 } from "@leapsake/crypto";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";
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
  }): Promise<void>;
  /** Run one push→pull cycle against the configured relay. */
  syncNow(): Promise<{ at: number }>;
  /**
   * Disconnect the account from this device: revoke the password + recovery
   * doors but keep the master key in the enclave, so local data stays readable.
   */
  clear(): Promise<void>;
}

// Build the core exactly once for the whole app and share it through context.
// This is the multi-screen successor to the proof screen's per-effect bootstrap
// (old App.tsx): open the on-device SQLite file, run the shared migrations on
// expo-sqlite, then `createCore`. Every screen reads the ready CoreApi via
// `useCore()` and calls it in-process — no IPC, unlike desktop.
const CoreContext = createContext<CoreApi | null>(null);
const SyncContext = createContext<SyncApi | null>(null);

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

export function CoreProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<CoreApi | null>(null);
  const [sync, setSync] = useState<SyncApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The unlocked device key material (custody Phase 0), passed into createCore so
  // it can encrypt sensitive fields at rest under per-item content keys.
  const keySession = useRef<KeySession | null>(null);

  useEffect(() => {
    (async () => {
      const db = await SQLite.openDatabaseAsync("leapsake.db");
      const driver = expoSqliteDriver(db);
      await runMigrations(driver);
      // The same keystore instance that backs the enable-sync door below.
      const keyStore = secureStoreKeyStore();
      keySession.current = await ensureDeviceMasterKey({ keyStore, driver });
      setCore(createCore(driver, keySession.current));
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
          const { account, recoveryKey, bootstrap } = await enableSync({
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
            await clearLocalAccount({ driver });
            throw new Error(relayErrorMessage(cause, relayUrl), { cause });
          }
          return {
            accountId: account.id,
            recoveryKey: bytesToBase64(recoveryKey),
          };
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
          // Adopt the account's master key everywhere: rebuild the core on the
          // adopted session and swap it in place (desktop does this via its IPC
          // Proxy; here `setCore` re-renders consumers with the new core).
          keySession.current = session;
          setCore(createCore(driver, session));
        },
        syncNow() {
          if (keySession.current === null) {
            throw new Error("Sync is not enabled for this store.");
          }
          return runAccountSync({
            driver,
            masterKey: keySession.current.masterKey,
          });
        },
        clear: () => clearLocalAccount({ driver }),
      });
    })().catch((e) => setError(String(e)));
  }, []);

  if (error !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
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
      <SyncContext.Provider value={sync}>{children}</SyncContext.Provider>
    </CoreContext.Provider>
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
});
