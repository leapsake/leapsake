import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Link, Stack } from "expo-router";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { SyncStatus } from "@leapsake/core";
import { useCore, useSync } from "../lib/core-context";
import { exportAndShare } from "../lib/export-share";
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
 * It is also *inside* both of them ({@link ExportFirstOffer}), because above is
 * not enough at the moment that matters: a user who has already opened a
 * confirmation should not have to back out of it to find the export, and that
 * confirmation is the last instant at which an export is still possible.
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
 * whether anything keeps a durable copy and reports `durableBackup`. Absent an
 * answer — today's universal case — it is `false` and this shows the alarming
 * version, hard-confirm and all. When server-side backup ships, that copy stops
 * appearing on its own.
 */
function ForgetAccountSection() {
  const sync = useSync();
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

  // Nothing keeps a durable copy, so the data on this device is the last copy.
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
              on this device. This account is only on this device, so there is
              no other copy.
            </Text>
            <ExportFirstOffer disabled={working} />
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
            from this device? A copy of your data is kept elsewhere, so you can
            get it again.
          </Text>
        )}
        {/* Offered in **both** branches, not only when this is the last copy: a
            user is entitled to their own file whether or not somebody else is
            holding one, and `durableBackup` is a claim this device cannot
            verify. Only the wording above branches. */}
        {!lastCopy && <ExportFirstOffer disabled={working} />}
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
          {/* The accountless wipe is by definition destroying the only copy, so
              it needs the offer at least as much as Forget account does. */}
          <ExportFirstOffer disabled={working} />
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
 * **One export, wired to this platform** — build the archive, write it to Caches,
 * hand it to the share sheet, delete it, and hold the button state while that
 * happens. The *sequence* lives in `lib/export-share.ts`, which is the tier that
 * can test it; this is only the expo wiring, and it exists once because there are
 * three buttons behind it ({@link ExportSection} and two {@link ExportFirstOffer}s).
 *
 * ⚠️ **It must not use iCloud, ever** — an iCloud entitlement in any shipped
 * build permanently disqualifies the Apple app-record transfer. `expo-sharing`
 * adds none: its config plugin is for the *inbound* share extension (and would
 * add an App Group entitlement), is opt-in, and is deliberately **not** in
 * `app.json`. The user picking iCloud Drive out of the share sheet is their own
 * act through `UIDocumentPickerViewController` and needs nothing from us.
 */
function useExportShare() {
  const core = useCore();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    setWorking(true);
    try {
      setResult(
        await exportAndShare({
          archive: () => core.export.archive({ appVersion: APP_VERSION }),
          // **Caches, not documents** — see `export-share.ts`, which is where the
          // reason lives now that three callers depend on it.
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

/**
 * **Export** — the whole store as one `.zip` the user keeps, handed to the system
 * share sheet.
 *
 * The reason this exists at all is that v0.1 is single-device by construction:
 * the app container is the only place a user's data lives, so until there is a
 * file they can save, "delete and reinstall" is data loss. That is also why it
 * needs no account — the accountless store is precisely the one with no other
 * copy (`plans/shipping.md` → Part 1, step 1).
 */
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
        disabled={working}
        onPress={run}
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

/**
 * **The same export, offered inside a confirmation that is about to destroy the
 * only copy** — the promise `key-custody/README.md` carried since before there
 * was an exporter.
 *
 * Above the type-to-confirm field, never below it: the order of the section is
 * the warning, the way out, the ceremony, then the destruction — and keeping the
 * danger button's neighbours unchanged is also what keeps
 * `maestro/subflows/factory-reset.yaml`'s keyboard handling honest.
 *
 * Styled as the ordinary accent button — the same affordance as the Export
 * section above, because it is the same act. It is deliberately *not* dressed as
 * a secondary/`colors.border` control like Cancel: white on `#ded3c2` is the
 * weakest thing on the screen, and the one button here whose whole purpose is to
 * be noticed cannot be the one nobody reads. Red destroys, blue exports, tan
 * backs out. Its own testIDs, not the Export section's, because both can be
 * showing a result at the same time.
 *
 * `disabled` is the destructive action already running — there is nothing left to
 * export by then, and the screen is about to unmount.
 */
function ExportFirstOffer({ disabled = false }: { disabled?: boolean }) {
  const { working, result, error, run } = useExportShare();

  return (
    <>
      <Pressable
        testID="export-first-start"
        style={[styles.button, (working || disabled) && { opacity: 0.5 }]}
        disabled={working || disabled}
        onPress={run}
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
