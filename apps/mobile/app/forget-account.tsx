import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import type { SyncStatus } from "@leapsake/core";
import { ExportFirstOffer } from "../components/ExportFirstOffer";
import { useAccount } from "../lib/core-context";
import { showFormProblem } from "../lib/form-problem";
import { styles } from "../lib/styles";
import { Button } from "../components/Button";
import { FormScrollView } from "../components/FormScrollView";

/** The word a user must type to arm the (irreversible) account deletion. */
const FORGET_ACCOUNT_PHRASE = "DELETE";

const TEXT = {
  title: "Forget account",
  lastCopyTitle: "Delete all data on this device",
  lastCopyBody: (username?: string) =>
    username !== undefined
      ? `This permanently deletes everything in the account “${username}” on this device. This account is only on this device, so there is no other copy.`
      : "This permanently deletes everything in this account on this device. This account is only on this device, so there is no other copy.",
  keptBody: (username?: string) =>
    username !== undefined
      ? `Remove “${username}” from this device? A copy of your data is kept elsewhere, so you can get it again.`
      : "Remove this account from this device? A copy of your data is kept elsewhere, so you can get it again.",
  confirmLabel: `Type ${FORGET_ACCOUNT_PHRASE} to confirm`,
  notConfirmed: "Not confirmed yet",
  typeToConfirm: `Type ${FORGET_ACCOUNT_PHRASE} in the box above to confirm.`,
  deleteAll: "Delete all data",
  forget: "Forget account",
  removing: "Removing…",
  checkFailed: "Couldn't check this account.",
  failed: "Couldn't remove it.",
} as const;

/**
 * Remove this account and its data. Unless something claims a durable copy,
 * it is worded as the deletion it is, with a typed confirmation.
 */
export default function ForgetAccountScreen() {
  const account = useAccount();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [info, setInfo] = useState<{
    username?: string;
    durableBackup: boolean;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void account.status().then(setStatus);
    account
      .forgetInfo()
      .then(setInfo)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : TEXT.checkFailed);
      });
  }, [account]);

  // Nothing keeps a durable copy, so the data on this device is the last copy.
  const lastCopy = info !== null && !info.durableBackup;
  const armed =
    !lastCopy || typed.trim().toUpperCase() === FORGET_ACCOUNT_PHRASE;

  async function forget() {
    if (working) return;
    if (!armed) return showFormProblem(TEXT.typeToConfirm, TEXT.notConfirmed);
    setError(null);
    setWorking(true);
    try {
      await account.forgetAccount();
      // The provider rebuilds in place; this screen unmounts to the fresh app.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : TEXT.failed);
      setWorking(false);
    }
  }

  if (status !== null && !status.hasAccount) return <Redirect href="/data" />;

  return (
    <>
      <Stack.Screen
        options={{ title: lastCopy ? TEXT.lastCopyTitle : TEXT.title }}
      />
      <FormScrollView contentContainerStyle={styles.screen}>
        {info === null ? (
          error === null && <ActivityIndicator />
        ) : (
          <>
            <Text style={styles.muted}>
              {lastCopy
                ? TEXT.lastCopyBody(info.username)
                : TEXT.keptBody(info.username)}
            </Text>
            {/* Offered either way: `durableBackup` is a claim this device
                cannot verify. */}
            <ExportFirstOffer busy={working} />
            {lastCopy && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{TEXT.confirmLabel}</Text>
                {/* An E2E anchor: an empty field has no text. */}
                <TextInput
                  testID="forget-account-confirm"
                  style={styles.input}
                  value={typed}
                  onChangeText={setTyped}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
            )}
            <Button
              label={
                working
                  ? TEXT.removing
                  : lastCopy
                    ? TEXT.deleteAll
                    : TEXT.forget
              }
              tone="destructive"
              busy={working}
              faded={!armed}
              onPress={() => void forget()}
            />
          </>
        )}
        {error !== null && (
          <Text style={styles.danger} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </FormScrollView>
    </>
  );
}
