import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { DATABASE_KEY, RECOVERY_KEY } from "@leapsake/crypto";
import { KEYSTORE_SECRET_IDS } from "@leapsake/core";
import { secureStoreKeyStore } from "../../keystore/secure-store-keystore";
import { colors, styles } from "../../lib/styles";
import { TEST_ONLY_MARKER } from "../test-only";

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Deletes secrets from the secure store to simulate losing the OS keychain: the db-key
 * alone, the device identity alone, or everything.
 */
export default function ClearKeys() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function clear(scope: "db-key" | "everything" | "device-identity") {
    setState({ kind: "working" });
    try {
      const keyStore = secureStoreKeyStore();
      const ids =
        scope === "db-key"
          ? [DATABASE_KEY]
          : scope === "device-identity"
            ? KEYSTORE_SECRET_IDS.filter(
                (id) => id !== DATABASE_KEY && id !== RECOVERY_KEY,
              )
            : KEYSTORE_SECRET_IDS;
      for (const id of ids) await keyStore.deleteSecret(id);
      setState({ kind: "done" });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Clear db-key (dev)" }} />
      <ScrollView
        nativeID={TEST_ONLY_MARKER}
        contentContainerStyle={styles.screen}
      >
        <View style={styles.section}>
          <Text style={styles.rowText}>
            Deletes only the secure-store{" "}
            <Text style={{ fontWeight: "700" }}>db-key</Text>, simulating
            OS-keychain loss. The encrypted database and the recovery sidecar
            are left intact, so the next launch shows the recovery-phrase gate.
          </Text>
          <Text style={styles.rowText}>
            <Text style={{ fontWeight: "700" }}>Clear everything</Text> also
            deletes <Text style={{ fontWeight: "700" }}>device-id</Text> and{" "}
            <Text style={{ fontWeight: "700" }}>enclave</Text> — the shape a
            real OS reinstall or signing-identity change leaves, and the only
            way to reach the master-key repair (custody slice 9). Clearing just
            the db-key keeps this device's identity, so the next launch has
            nothing to repair.
          </Text>
          <Text style={styles.rowText}>
            <Text style={{ fontWeight: "700" }}>Clear device identity</Text>{" "}
            drops those two but <Text style={{ fontWeight: "700" }}>keeps</Text>{" "}
            the db-key — a partial loss, so the store opens with no gate and no
            door is ever offered. That is the only way to reach the{" "}
            <Text style={{ fontWeight: "700" }}>Degraded</Text> state (custody
            slice 10): the app opens, works, and pauses sync.
          </Text>
        </View>

        {state.kind === "done" ? (
          <View
            testID="dev-clear-dbkey-status"
            accessibilityLabel="CLEARED"
            style={[banner, { backgroundColor: "#1a7f37" }]}
          >
            <Text style={bannerText}>Keychain cleared</Text>
            <Text style={[bannerText, { fontWeight: "400" }]}>
              Force-quit and relaunch the app to hit the recovery gate.
            </Text>
          </View>
        ) : state.kind === "error" ? (
          <View
            testID="dev-clear-dbkey-status"
            accessibilityLabel="ERROR"
            style={[banner, { backgroundColor: colors.danger }]}
          >
            <Text style={bannerText}>Couldn't clear db-key</Text>
            <Text style={[bannerText, { fontWeight: "400" }]}>
              {state.message}
            </Text>
          </View>
        ) : (
          <Pressable
            testID="dev-clear-dbkey-button"
            style={[
              banner,
              {
                backgroundColor: colors.danger,
                opacity: state.kind === "working" ? 0.5 : 1,
              },
            ]}
            disabled={state.kind === "working"}
            onPress={() => void clear("db-key")}
          >
            <Text style={bannerText}>
              {state.kind === "working" ? "Clearing…" : "Clear db-key"}
            </Text>
          </Pressable>
        )}

        {state.kind === "idle" || state.kind === "working" ? (
          <Pressable
            testID="dev-clear-identity-button"
            style={[
              banner,
              {
                backgroundColor: colors.danger,
                opacity: state.kind === "working" ? 0.5 : 1,
              },
            ]}
            disabled={state.kind === "working"}
            onPress={() => void clear("device-identity")}
          >
            <Text style={bannerText}>
              {state.kind === "working" ? "Clearing…" : "Clear device identity"}
            </Text>
          </Pressable>
        ) : null}

        {state.kind === "idle" || state.kind === "working" ? (
          <Pressable
            testID="dev-clear-keychain-button"
            style={[
              banner,
              {
                backgroundColor: colors.danger,
                opacity: state.kind === "working" ? 0.5 : 1,
              },
            ]}
            disabled={state.kind === "working"}
            onPress={() => void clear("everything")}
          >
            <Text style={bannerText}>
              {state.kind === "working" ? "Clearing…" : "Clear everything"}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </>
  );
}

const banner = {
  borderRadius: 8,
  padding: 16,
  gap: 4,
} as const;

const bannerText = {
  color: "#ffffff",
  fontSize: 18,
  fontWeight: "700",
} as const;
