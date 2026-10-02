import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type { SyncStatus } from "@leapsake/core";
import {
  ExportFirstOffer,
  useExportShare,
} from "../components/ExportFirstOffer";
import { LinkButton } from "../components/LinkButton";
import { useAccount } from "../lib/core-context";
import { showFormProblem } from "../lib/form-problem";
import { styles } from "../lib/styles";

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

/** The word a user must type to arm the (irreversible) account deletion. */
const FORGET_ACCOUNT_PHRASE = "DELETE";

const NOT_CONFIRMED = "Not confirmed yet";
const typeToConfirm = (phrase: string) =>
  `Type ${phrase} in the box above to confirm.`;

/**
 * Remove this account and its data. Unless something claims a durable copy,
 * it is worded as the deletion it is, with a typed confirmation.
 */
function ForgetAccountSection() {
  const account = useAccount();
  const [info, setInfo] = useState<{
    username?: string;
    durableBackup: boolean;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Read on entering the confirmation rather than on mount.
  function beginConfirm() {
    setError(null);
    account
      .forgetInfo()
      .then(setInfo)
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't check this account.",
        );
      });
  }

  function cancel() {
    setInfo(null);
    setTyped("");
    setError(null);
  }

  // Nothing keeps a durable copy, so the data on this device is the last copy.
  const lastCopy = info !== null && !info.durableBackup;
  const armed =
    !lastCopy || typed.trim().toUpperCase() === FORGET_ACCOUNT_PHRASE;

  async function forget() {
    if (working) return;
    if (!armed)
      return showFormProblem(
        typeToConfirm(FORGET_ACCOUNT_PHRASE),
        NOT_CONFIRMED,
      );
    setError(null);
    setWorking(true);
    try {
      await account.forgetAccount();
      // The provider rebuilds in place; this screen unmounts to the fresh app.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't remove it.");
      setWorking(false);
    }
  }

  if (info === null) {
    return (
      <View style={{ marginTop: 24, gap: 8 }}>
        <Text style={styles.title}>Forget account</Text>
        <Text style={styles.muted}>
          Remove this account and everything in it from this device. This is not
          signing out — the data is deleted, not locked.
        </Text>
        <Pressable
          style={[styles.button, styles.buttonDestructive, styles.buttonBlock]}
          onPress={beginConfirm}
        >
          <Text style={styles.buttonText}>Forget account…</Text>
        </Pressable>
        {error !== null && (
          <Text style={styles.danger} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>
        {lastCopy ? "Delete all data on this device" : "Forget account"}
      </Text>
      <View style={styles.section}>
        {lastCopy ? (
          <>
            <Text style={styles.muted}>
              This permanently deletes everything in{" "}
              {info.username !== undefined
                ? `the account “${info.username}”`
                : "this account"}{" "}
              on this device. This account is only on this device, so there is
              no other copy.
            </Text>
            <ExportFirstOffer busy={working} />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Type {FORGET_ACCOUNT_PHRASE} to confirm
              </Text>
              {/* An empty field gives an E2E driver nothing else to select. */}
              <TextInput
                testID="forget-account-confirm"
                style={styles.input}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
          </>
        ) : (
          <Text style={styles.muted}>
            Remove{" "}
            {info.username !== undefined
              ? `“${info.username}”`
              : "this account"}{" "}
            from this device? A copy of your data is kept elsewhere, so you can
            get it again.
          </Text>
        )}
        {/* Offered either way: `durableBackup` is a claim this device cannot
            verify. */}
        {!lastCopy && <ExportFirstOffer busy={working} />}
        <Pressable
          style={[
            styles.button,
            styles.buttonDestructive,
            styles.buttonBlock,
            (!armed || working) && { opacity: 0.5 },
          ]}
          accessibilityState={{ busy: working }}
          onPress={forget}
        >
          <Text style={styles.buttonText}>
            {working
              ? "Removing…"
              : lastCopy
                ? "Delete all data"
                : "Forget account"}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.buttonSecondary, styles.buttonBlock]}
          accessibilityState={{ busy: working }}
          onPress={() => {
            if (!working) cancel();
          }}
        >
          <Text style={styles.buttonSecondaryText}>Cancel</Text>
        </Pressable>
        {error !== null && (
          <Text style={styles.danger} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </View>
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
      <Pressable
        testID="export-start"
        style={[styles.button, styles.buttonBlock, working && { opacity: 0.5 }]}
        accessibilityState={{ busy: working }}
        onPress={run}
      >
        <Text style={styles.buttonText}>
          {working ? "Preparing…" : "Export data"}
        </Text>
      </Pressable>
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
