import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as SQLite from "expo-sqlite";
import { type CoreApi, createCore, runMigrations } from "@leapsake/core";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";

// Build the core exactly once for the whole app and share it through context.
// This is the multi-screen successor to the proof screen's per-effect bootstrap
// (old App.tsx): open the on-device SQLite file, run the shared migrations on
// expo-sqlite, then `createCore`. Every screen reads the ready CoreApi via
// `useCore()` and calls it in-process — no IPC, unlike desktop.
const CoreContext = createContext<CoreApi | null>(null);

/** Access the ready CoreApi. Throws if used outside a (loaded) CoreProvider. */
export function useCore(): CoreApi {
  const core = useContext(CoreContext);
  if (core === null) {
    throw new Error("useCore must be used within a CoreProvider");
  }
  return core;
}

export function CoreProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<CoreApi | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = await SQLite.openDatabaseAsync("leapsake.db");
      const driver = expoSqliteDriver(db);
      await runMigrations(driver);
      setCore(createCore(driver));
    })().catch((e) => setError(String(e)));
  }, []);

  if (error !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (core === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return <CoreContext.Provider value={core}>{children}</CoreContext.Provider>;
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
