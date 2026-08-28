import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link, Stack } from "expo-router";
import type { SyncStatus } from "@leapsake/core";
import { useSync } from "../lib/core-context";
import { colors, styles } from "../lib/styles";

/**
 * **Data** — where data comes in and where it goes out. A root-stack screen
 * reached from the Settings tab.
 *
 * Import from Contacts lives here because it lost its only other entry point:
 * it used to be the third button on the "+ Add" chooser that app/add.tsx
 * replaced. (The create form links to it too, for the user who is already
 * halfway through adding someone by hand.)
 *
 * The destructive actions moved here **from Settings**, which was carrying them
 * below account and sync setup. Nothing about them changed in the move — same
 * two sections, same copy, same either/or — because their wording is load-bearing
 * (`model.md` §7.2/§7.3) and this was a relocation, not a redesign.
 */
export default function DataScreen() {
  const sync = useSync();
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    void sync.status().then(setStatus);
  }, [sync]);

  return (
    <>
      <Stack.Screen options={{ title: "Data" }} />
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title}>Import</Text>
        <Link href="/import" style={styles.row}>
          <Text style={[styles.rowText, { color: colors.accent }]}>
            📇 Import from contacts
          </Text>
        </Link>

        {/*
          The two ways to be rid of what is on this device, one per custody state
          (`model.md` §7.2), mirroring desktop. With an account, "Forget account"
          removes it and its store; without one there is nothing to forget, so the
          accountless wipe is the only shape the action can take. Showing both at
          once was showing one act twice — they land in the identical place.
        */}
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
 * **Forget account** (`model.md` §7.3) — remove this account and its data from
 * this device. Named as removal so it can never be mistaken for signing out.
 *
 * The wording is **driven by a check, not hardcoded** (§7.3.1): the provider asks
 * the relay whether it keeps a durable copy and reports `durableBackup`. Absent an
 * answer — today's universal case, since no relay advertises the capability yet —
 * it is `false` and this shows the alarming version, hard-confirm and all. When
 * server-side backup ships, that copy stops appearing on its own.
 */
function ForgetAccountSection() {
  const sync = useSync();
  const [info, setInfo] = useState<{
    username?: string;
    relayUrl?: string;
    durableBackup: boolean;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Read on entering the confirmation rather than on mount: it reaches out to
  // the relay, and there is no reason to do that for every visit to this screen.
  function beginConfirm() {
    setError(null);
    sync
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

  // A relay that keeps a durable copy makes this ordinary — sign back in and
  // re-pull. Without one, the data on this device is the last copy.
  const lastCopy = info !== null && !info.durableBackup;
  const armed =
    !lastCopy || typed.trim().toUpperCase() === FORGET_ACCOUNT_PHRASE;

  async function forget() {
    if (!armed) return;
    setError(null);
    setWorking(true);
    try {
      await sync.forgetAccount();
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
          style={[styles.button, { backgroundColor: colors.border }]}
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
              on this device.{" "}
              {info.relayUrl === undefined
                ? "This account is only on this device, so there is no other copy."
                : `${info.relayUrl} does not keep a backup of your data, so if this is your only device there is no other copy.`}
            </Text>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Type {FORGET_ACCOUNT_PHRASE} to confirm
              </Text>
              <TextInput
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
            from this device? {info.relayUrl} keeps a copy of your data, so you
            can sign back in to get it again.
          </Text>
        )}
        <Pressable
          style={[
            styles.button,
            lastCopy && { backgroundColor: colors.danger },
            (!armed || working) && { opacity: 0.5 },
          ]}
          disabled={!armed || working}
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
          disabled={working}
          onPress={cancel}
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
 * Factory reset: erase everything on this device and rebuild the app as a fresh
 * install.
 *
 * **Shown only while this device is Unauthenticated** (`model.md` §7.2) — with an account,
 * {@link ForgetAccountSection} is the same act under the name that fits, and
 * offering both was offering one act twice. That is also why the copy no longer
 * branches on whether sync is set up: an Unauthenticated device has no account, so this data
 * is by definition the only copy.
 *
 * Gated behind a type-to-confirm step (the danger-styled button stays disabled
 * until the user types {@link FACTORY_RESET_PHRASE}) because nothing about it is
 * recoverable. On success the provider rebuilds in place, so this screen unmounts
 * into a clean app — there is no completion state to render.
 */
function FactoryResetSection() {
  const sync = useSync();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const armed = typed.trim().toUpperCase() === FACTORY_RESET_PHRASE;

  async function reset() {
    if (!armed) return;
    setError(null);
    setWorking(true);
    try {
      await sync.factoryReset();
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
          style={[styles.button, { backgroundColor: colors.border }]}
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
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              Type {FACTORY_RESET_PHRASE} to confirm
            </Text>
            {/*
              The E2E catalog resets the app through this screen rather than through
              `clearState` or a container wipe: those also erase the dev-launcher's
              remembered dev server, and the next flow would find the launcher instead
              of the app. Empty, the field offers a driver nothing to select it by.
            */}
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
              { backgroundColor: colors.danger },
              (!armed || working) && { opacity: 0.5 },
            ]}
            disabled={!armed || working}
            onPress={reset}
          >
            <Text style={styles.buttonText}>
              {working ? "Erasing…" : "Erase everything"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, { backgroundColor: colors.border }]}
            disabled={working}
            onPress={cancel}
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
