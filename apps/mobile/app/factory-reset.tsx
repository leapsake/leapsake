import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import type { SyncStatus } from "@leapsake/core";
import { ExportFirstOffer } from "../components/ExportFirstOffer";
import { useAccount } from "../lib/core-context";
import { showFormProblem } from "../lib/form-problem";
import { styles } from "../lib/styles";
import { Button } from "../components/Button";

/** The word a user must type to arm the (irreversible) factory reset. */
const FACTORY_RESET_PHRASE = "ERASE";

const TEXT = {
  title: "Factory reset",
  body: "This permanently erases all data on this device — all people, pets, reminders, and settings. There is no account holding a copy, so this data cannot be recovered afterward.",
  confirmLabel: `Type ${FACTORY_RESET_PHRASE} to confirm`,
  notConfirmed: "Not confirmed yet",
  typeToConfirm: `Type ${FACTORY_RESET_PHRASE} in the box above to confirm.`,
  erase: "Erase everything",
  erasing: "Erasing…",
  failed: "Couldn't reset.",
} as const;

/**
 * Erase everything and boot as a fresh install, for an Unauthenticated device;
 * one with an account is sent back to Data, whose way out is Forget account.
 */
export default function FactoryResetScreen() {
  const account = useAccount();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void account.status().then(setStatus);
  }, [account]);

  const armed = typed.trim().toUpperCase() === FACTORY_RESET_PHRASE;

  async function reset() {
    if (working) return;
    if (!armed) return showFormProblem(TEXT.typeToConfirm, TEXT.notConfirmed);
    setError(null);
    setWorking(true);
    try {
      await account.factoryReset();
      // The provider rebuilds in place; this screen unmounts to the fresh app.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : TEXT.failed);
      setWorking(false);
    }
  }

  if (status?.hasAccount) return <Redirect href="/data" />;

  return (
    <>
      <Stack.Screen options={{ title: TEXT.title }} />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.muted}>{TEXT.body}</Text>
        {/* The accountless wipe always destroys the only copy. */}
        <ExportFirstOffer busy={working} />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{TEXT.confirmLabel}</Text>
          {/* An empty field gives an E2E driver nothing else to select. */}
          <TextInput
            testID="factory-reset-confirm"
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>
        <Button
          label={working ? TEXT.erasing : TEXT.erase}
          tone="destructive"
          busy={working}
          faded={!armed}
          onPress={() => void reset()}
        />
        {error !== null && (
          <Text style={styles.danger} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </ScrollView>
    </>
  );
}
