import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link, Stack } from "expo-router";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { SyncStatus } from "@leapsake/core";
import { useCore, useSync } from "../lib/core-context";
import { colors, styles } from "../lib/styles";

/**
 * **Data** — where data comes in and where it goes out. A root-stack screen
 * reached from the Settings tab.
 *
 * Export leads, and is the section this screen most needs: v0.1 is
 * single-device, so until the user has a file of their own the two destructive
 * actions at the bottom of this same screen are the only copy meeting its end.
 * Putting the way out directly above them is the point.
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
        <ExportSection />

        <Text style={[styles.title, { marginTop: 24 }]}>Import</Text>
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
              {/* The Authenticated half of the reset the E2E arc drives — see the
                  note on `factory-reset-confirm` above. Empty, it offers a driver
                  nothing to select it by. */}
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

/** The app version stamped into the archive, from the one source `app.config.ts`
 *  derives Expo's own from — never a second copy. */
const APP_VERSION = Constants.expoConfig?.version ?? "unknown";

/**
 * **Export** — the whole store as one `.zip` the user keeps, handed to the system
 * share sheet.
 *
 * The reason this exists at all is that v0.1 is single-device by construction:
 * the app container is the only place a user's data lives, so until there is a
 * file they can save, "delete and reinstall" is data loss. That is also why it
 * needs no account — the accountless store is precisely the one with no other
 * copy (`plans/shipping.md` → Part 1, step 1).
 *
 * ⚠️ **It must not use iCloud, ever** — an iCloud entitlement in any shipped
 * build permanently disqualifies the Apple app-record transfer. `expo-sharing`
 * adds none: its config plugin is for the *inbound* share extension (and would
 * add an App Group entitlement), is opt-in, and is deliberately **not** in
 * `app.json`. The user picking iCloud Drive out of the share sheet is their own
 * act through `UIDocumentPickerViewController` and needs nothing from us.
 */
function ExportSection() {
  const core = useCore();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    setError(null);
    setResult(null);
    setWorking(true);
    // Built in memory, written once, shared, and deleted — the file exists only
    // for as long as the share sheet needs a URL to point at.
    let file: File | null = null;
    try {
      const { bytes, filename, counts } = await core.export.archive({
        appVersion: APP_VERSION,
      });

      // **Caches, not documents**, and that is load-bearing rather than tidiness:
      // `Library/Caches` is excluded from device backup, so a plaintext dump of
      // the user's whole address book can never ride along inside an iCloud
      // device backup. Writing it to the documents directory is the one way this
      // feature could violate the no-iCloud constraint by accident.
      file = new File(Paths.cache, filename);
      if (file.exists) file.delete(); // a second export the same day
      file.write(bytes);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/zip",
          UTI: "public.zip-archive",
          dialogTitle: "Save your Leapsake export",
        });
      } else {
        setError("Sharing isn't available on this device.");
        return;
      }

      setResult(
        `Exported ${counts.people} ${counts.people === 1 ? "person" : "people"}` +
          `, ${counts.pets} ${counts.pets === 1 ? "pet" : "pets"}` +
          `, ${counts.contactMethods} contact ${
            counts.contactMethods === 1 ? "method" : "methods"
          }` +
          // The rest of the archive — reminders, gift ideas, holiday choices,
          // notification settings. Without this the half of the file that is
          // not contacts is invisible from outside the zip.
          `, ${counts.otherRecords} other ${
            counts.otherRecords === 1 ? "record" : "records"
          } (${Math.max(1, Math.round(counts.bytes / 1024))} KB).`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't export your data.",
      );
    } finally {
      // On dismiss, whether the share succeeded, failed or the user backed out:
      // the archive is plaintext, so it does not sit in the container waiting to
      // be found. Deleting this promptly is safe rather than a race —
      // `shareAsync` resolves from `UIActivityViewController`'s completion
      // handler, which fires after the chosen activity has finished with the
      // file, so Files and AirDrop have their copy by the time we get here.
      try {
        if (file?.exists) file.delete();
      } catch {
        // A file we cannot delete is not a reason to fail an export that worked;
        // Caches is reclaimed by the system anyway.
      }
      setWorking(false);
    }
  }

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
        disabled={working}
        onPress={() => void exportData()}
      >
        <Text style={styles.buttonText}>
          {working ? "Preparing…" : "Export my data…"}
        </Text>
      </Pressable>
      {result !== null && (
        // Reports what actually left the device — and what the E2E flow selects
        // on, rather than asserting against the share sheet itself.
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
