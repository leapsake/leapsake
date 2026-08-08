import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { DATABASE_KEY, RECOVERY_KEY } from "@leapsake/crypto";
import { KEYSTORE_SECRET_IDS } from "@leapsake/core";
import { secureStoreKeyStore } from "../keystore/secure-store-keystore";
import { colors, styles } from "../lib/styles";

/**
 * Dev-only affordance to simulate OS-keychain loss for verifying single-device
 * boot recovery (`plans/status.md` → mobile scenario 8; encryption `model.md` §6).
 *
 * **Clear db-key** deletes only that secret from `expo-secure-store`, leaving the
 * `recovery-key`, the encrypted store, and its doors all intact. On the next
 * launch the boot in `core-context.tsx` finds no enclave key but surviving doors
 * and shows the `RecoveryGate`, so a door can be exercised end-to-end. A full
 * reinstall can't stand in for this — it wipes the store and the doors too, so
 * there's nothing to recover into.
 *
 * **Clear everything** additionally deletes `device-id` and `enclave`, which is
 * what an OS reinstall or a signing-identity change actually costs a user
 * (`packages/key-custody/README.md`). That is the only way to reach custody slice 9's
 * master-key repair: with the device identity intact the enclave still vouches
 * for the right key and the repair correctly reports `"unchanged"`. It is the
 * mobile counterpart of deleting `keystore.json` from a desktop profile.
 *
 * **Clear device identity** deletes `device-id` and `enclave` but *keeps* the
 * db-key — a **partial** keychain loss, and the one route to custody slice 10's
 * **Degraded** state. Because the db-key survives, the store opens with no gate,
 * so no door is ever presented and nothing can repair the enclave: the boot finds
 * an account it cannot prove a master key for, opens anyway, and pauses sync. On
 * desktop the same state is reached by deleting exactly those two entries from
 * `keystore.json`; mobile keeps its secrets in the OS keychain, where nothing
 * outside the app can edit them one at a time — hence this button.
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
      <ScrollView contentContainerStyle={styles.screen}>
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
