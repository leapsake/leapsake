import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SQLite from "expo-sqlite";
import { createCore, runMigrations } from "@leapsake/core";
import { fullName, type Person } from "@leapsake/schema";
import { expoSqliteDriver } from "./db/expo-sqlite-driver";

// Proof-of-data-layer screen (reboot-plan V2 step 1b): open an on-device SQLite
// file, run the shared migrations on expo-sqlite, build `@leapsake/core`, and
// perform one real CoreApi round-trip — mirroring the desktop bootstrap in
// apps/desktop/src/main/index.ts. If the seeded person renders, the shared
// data/core packages run on Hermes against expo-sqlite with no source changes.
export default function App() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = await SQLite.openDatabaseAsync("leapsake.db");
      const driver = expoSqliteDriver(db);
      await runMigrations(driver);
      const core = createCore(driver);

      // Seed once when empty: proves writes AND that data survives a relaunch,
      // without unbounded row growth across launches.
      if ((await core.people.list()).length === 0) {
        await core.people.create(
          {
            firstName: "Ada",
            middleName: null,
            lastName: "Lovelace",
            gender: null,
          },
          [],
        );
      }
      setPeople(await core.people.list());
    })().catch((e) => setError(String(e)));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>@leapsake/core on expo-sqlite</Text>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : people === null ? (
        <ActivityIndicator />
      ) : (
        people.map((person) => (
          <Text key={person.id} style={styles.value}>
            {fullName(person)}
          </Text>
        ))
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: "600",
  },
  value: {
    fontSize: 16,
  },
  error: {
    fontSize: 14,
    color: "#b00020",
  },
});
