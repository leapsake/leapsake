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
  createCore,
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
  runMigrations,
} from "@leapsake/core";
import { bytesToBase64 } from "@leapsake/crypto";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";
import { secureStoreKeyStore } from "../keystore/secure-store-keystore";

/** Mirror of the desktop main process's `MIN_PASSWORD_LENGTH` boundary check. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * The account / enable-sync surface (custody Phase 1). Kept deliberately separate
 * from {@link CoreApi}: enabling sync isn't a transactional core op, so — exactly
 * like desktop's separate `window.sync` bridge (not folded into `window.api`) — it
 * lives in its own context rather than on the core.
 */
export interface SyncApi {
  status(): Promise<SyncStatus>;
  /**
   * Establish the account + portable password door, returning the one-time
   * recovery key **base64-encoded** so raw key bytes never leave this layer
   * (mirrors desktop's IPC encoding).
   */
  enable(password: string): Promise<{ accountId: string; recoveryKey: string }>;
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
        async enable(password) {
          if (password.length < MIN_PASSWORD_LENGTH) {
            throw new Error(
              `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            );
          }
          const { account, recoveryKey } = await enableSync({
            keyStore,
            driver,
            password,
            platform: Platform.OS,
          });
          return {
            accountId: account.id,
            recoveryKey: bytesToBase64(recoveryKey),
          };
        },
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
