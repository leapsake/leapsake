import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { DATABASE_KEY } from "@leapsake/crypto";
import { secureStoreKeyStore } from "../keystore/secure-store-keystore";
import { colors, styles } from "../lib/styles";

/**
 * Dev-only affordance to simulate OS-keychain loss for verifying single-device
 * boot recovery (`plans/status.md` → mobile scenario 8; encryption `model.md` §6).
 *
 * It deletes **only** the `db-key` secret from `expo-secure-store`, leaving the
 * `recovery-key`, the encrypted `leapsake.db`, and the `leapsake-recovery.db`
 * sidecar all intact. On the next launch the boot in `core-context.tsx` finds no
 * enclave key but a surviving sidecar (case 2) and shows the `RecoveryGate`, so
 * the recovery phrase can be exercised end-to-end. A full reinstall can't stand
 * in for this — it wipes the DB and the sidecar too, so there's nothing to
 * recover into.
 *
 * Reached by deep link only (`leapsake://dev-clear-dbkey`), with no link from any
 * shipping screen, and `__DEV__`-gated so it redirects home (and never deletes
 * anything) in a release build. Mirrors the `dev-selftest` route's gating.
 */
export default function DevClearDbKeyScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <ClearDbKey />;
}

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "error"; message: string };

function ClearDbKey() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function clear() {
    setState({ kind: "working" });
    try {
      await secureStoreKeyStore().deleteSecret(DATABASE_KEY);
      setState({ kind: "done" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Clear db-key (dev)" }} />
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.section}>
          <Text style={styles.rowText}>
            Deletes only the secure-store <Text style={{ fontWeight: "700" }}>db-key</Text>,
            simulating OS-keychain loss. The encrypted database and the recovery
            sidecar are left intact, so the next launch shows the recovery-phrase
            gate.
          </Text>
        </View>

        {state.kind === "done" ? (
          <View
            testID="dev-clear-dbkey-status"
            accessibilityLabel="CLEARED"
            style={[banner, { backgroundColor: "#1a7f37" }]}
          >
            <Text style={bannerText}>db-key cleared</Text>
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
            <Text style={[bannerText, { fontWeight: "400" }]}>{state.message}</Text>
          </View>
        ) : (
          <Pressable
            testID="dev-clear-dbkey-button"
            style={[
              banner,
              { backgroundColor: colors.danger, opacity: state.kind === "working" ? 0.5 : 1 },
            ]}
            disabled={state.kind === "working"}
            onPress={() => void clear()}
          >
            <Text style={bannerText}>
              {state.kind === "working" ? "Clearing…" : "Clear db-key"}
            </Text>
          </Pressable>
        )}
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
