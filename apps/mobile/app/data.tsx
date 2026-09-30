import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link, Stack } from "expo-router";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { SyncStatus } from "@leapsake/core";
import { useCore, useAccount } from "../lib/core-context";
import { exportAndShare } from "../lib/export-share";
import { colors, styles } from "../lib/styles";

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

        <Text style={[styles.title, { marginTop: 24 }]}>Import</Text>
        <Link href="/import" style={styles.row}>
          <Text style={[styles.rowText, { color: colors.accent }]}>
            📇 Import from contacts
          </Text>
        </Link>

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
    if (working || !armed) return;
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
          disabled={!armed}
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
          style={[styles.button, { backgroundColor: colors.border }]}
          accessibilityState={{ busy: working }}
          onPress={() => {
            if (!working) cancel();
          }}
        >
          <Text style={styles.buttonText}>Cancel</Text>
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

/** The word a user must type to arm the (irreversible) factory reset. */
const FACTORY_RESET_PHRASE = "ERASE";

/**
 * Erase everything and boot as a fresh install, for an Unauthenticated device.
 * On success the provider rebuilds in place, so there is no done state.
 */
function FactoryResetSection() {
  const account = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const armed = typed.trim().toUpperCase() === FACTORY_RESET_PHRASE;

  async function reset() {
    if (working || !armed) return;
    setError(null);
    setWorking(true);
    try {
      await account.factoryReset();
      // The provider rebuilds in place; this screen unmounts to the fresh app.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't reset.");
      setWorking(false);
    }
  }

  function cancel() {
    setConfirming(false);
    setTyped("");
    setError(null);
  }

  return (
    <View style={{ marginTop: 24, gap: 8 }}>
      <Text style={styles.title}>Factory reset</Text>
      <Text style={styles.muted}>
        Erase everything on this device and start over — all people, pets,
        reminders, and settings.
      </Text>
      {!confirming ? (
        <Pressable
          style={[styles.button, styles.buttonDestructive, styles.buttonBlock]}
          onPress={() => setConfirming(true)}
        >
          <Text style={styles.buttonText}>Factory reset…</Text>
        </Pressable>
      ) : (
        <View style={styles.section}>
          <Text style={styles.muted}>
            This permanently erases all data on this device. There is no account
            holding a copy, so this data cannot be recovered afterward.
          </Text>
          {/* The accountless wipe always destroys the only copy. */}
          <ExportFirstOffer busy={working} />
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Type {FACTORY_RESET_PHRASE} to confirm
            </Text>
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
          <Pressable
            style={[
              styles.button,
              styles.buttonDestructive,
              styles.buttonBlock,
              (!armed || working) && { opacity: 0.5 },
            ]}
            accessibilityState={{ busy: working }}
            disabled={!armed}
            onPress={reset}
          >
            <Text style={styles.buttonText}>
              {working ? "Erasing…" : "Erase everything"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, { backgroundColor: colors.border }]}
            accessibilityState={{ busy: working }}
            onPress={() => {
              if (!working) cancel();
            }}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
          {error !== null && (
            <Text style={styles.danger} accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

/** The release version stamped into the archive, else the core version. */
const APP_VERSION =
  Constants.expoConfig?.extra?.release ??
  Constants.expoConfig?.version ??
  "unknown";

/**
 * The expo wiring for `exportAndShare`. ⚠️ Never iCloud, and no
 * `expo-sharing` plugin: `@leapsake/export` → It must never use iCloud.
 */
function useExportShare() {
  const core = useCore();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (working) return;
    setError(null);
    setResult(null);
    setWorking(true);
    try {
      setResult(
        await exportAndShare({
          archive: () => core.export.archive({ appVersion: APP_VERSION }),
          // Caches, not documents: see `export-share.ts`.
          write: (filename, bytes) => {
            const file = new File(Paths.cache, filename);
            if (file.exists) file.delete(); // a second export the same day
            file.write(bytes);
            return {
              uri: file.uri,
              remove: () => {
                if (file.exists) file.delete();
              },
            };
          },
          canShare: () => Sharing.isAvailableAsync(),
          share: (uri) =>
            Sharing.shareAsync(uri, {
              mimeType: "application/zip",
              UTI: "public.zip-archive",
              dialogTitle: "Save your Leapsake export",
            }),
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't export your data.",
      );
    } finally {
      setWorking(false);
    }
  }

  return { working, result, error, run: () => void run() };
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
        style={[styles.button, working && { opacity: 0.5 }]}
        accessibilityState={{ busy: working }}
        onPress={run}
      >
        <Text style={styles.buttonText}>
          {working ? "Preparing…" : "Export my data…"}
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

/**
 * The export, offered inside a destructive confirmation, above its typed
 * field. `busy` means the destruction is already running.
 */
function ExportFirstOffer({ busy = false }: { busy?: boolean }) {
  const { working, result, error, run } = useExportShare();

  return (
    <>
      <Pressable
        testID="export-first-start"
        style={[styles.button, (working || busy) && { opacity: 0.5 }]}
        accessibilityState={{ busy: working || busy }}
        onPress={() => {
          if (!busy) run();
        }}
      >
        <Text style={styles.buttonText}>
          {working ? "Preparing…" : "Export my data first…"}
        </Text>
      </Pressable>
      {result !== null && (
        <Text testID="export-first-result" style={styles.muted}>
          {result}
        </Text>
      )}
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </>
  );
}
