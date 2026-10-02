import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import type { SyncStatus } from "@leapsake/core";
import { useExportShare } from "../components/ExportFirstOffer";
import { LinkButton } from "../components/LinkButton";
import { useAccount } from "../lib/core-context";
import { styles } from "../lib/styles";
import { Button } from "../components/Button";

/**
 * Data in and out. Export leads, above the destructive actions and inside
 * their confirmations too, since this device may hold the only copy.
 */
export default function DataScreen() {
  const account = useAccount();
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    void account.status().then(setStatus);
  }, [account]);

  return (
    <>
      <Stack.Screen options={{ title: "Data" }} />
      <ScrollView contentContainerStyle={styles.screen}>
        <ExportSection />

        <View style={{ marginTop: 24, gap: 8 }}>
          <Text style={styles.title}>Import</Text>
          <LinkButton href="/import" label="Import contacts" glyph="📇" />
        </View>

        {/* One way to be rid of this device's data per custody state: both
            land in the same place. */}
        {status !== null &&
          (status.hasAccount ? (
            <ForgetAccountSection />
          ) : (
            <FactoryResetSection />
          ))}
      </ScrollView>
    </>
  );
}

/** The way to remove this account, which confirms on its own screen. */
function ForgetAccountSection() {
  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>Forget account</Text>
      <Text style={styles.muted}>
        Remove this account and everything in it from this device. This is not
        signing out — the data is deleted, not locked.
      </Text>
      <LinkButton
        href="/forget-account"
        label="Forget account"
        glyph="⚠️"
        tone="destructive"
        testID="forget-account-start"
      />
    </View>
  );
}

/** The way into the accountless wipe, which confirms on its own screen. */
function FactoryResetSection() {
  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>Factory reset</Text>
      <Text style={styles.muted}>
        Erase everything on this device and start over — all people, pets,
        reminders, and settings.
      </Text>
      <LinkButton
        href="/factory-reset"
        label="Factory reset"
        glyph="⚠️"
        tone="destructive"
        testID="factory-reset-start"
      />
    </View>
  );
}

/** The whole store as one `.zip`, via the share sheet; needs no account. */
function ExportSection() {
  const { working, result, error, run } = useExportShare();

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>Export</Text>
      <Text style={styles.muted}>
        Save everything on this device as a file you keep — your people and
        pets, their contact details, their dates and how they're related, plus
        your reminders, gift ideas and holiday choices. Leapsake doesn't upload
        it anywhere.
      </Text>
      <Button
        testID="export-start"
        label={working ? "Preparing…" : "Export data"}
        busy={working}
        onPress={run}
      />
      {result !== null && (
        // What left the device, which the E2E flow asserts on.
        <Text testID="export-result" style={styles.muted}>
          {result}
        </Text>
      )}
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}
