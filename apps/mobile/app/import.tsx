import { type ReactNode, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import {
  Contact,
  getPermissionsAsync,
  requestPermissionsAsync,
} from "expo-contacts";
import type { ImportResult } from "@leapsake/core";
import {
  observeDeviceContactSync,
  syncDeviceContacts,
} from "../lib/device-contacts-sync";
import { useCore, useAccount } from "../lib/core-context";
import {
  CreateAccountForm,
  RecoveryKeyReveal,
} from "../components/ProtectData";
import { styles } from "../lib/styles";

// Import from Contacts, which switches the sync on; with no account it first
// offers one (the app's README → Keeping People in step).

type Access = "all" | "limited";

type State =
  /** Reading custody, which the offer depends on. */
  | { phase: "checking" }
  /** No account: offer to encrypt this device before the address book lands. */
  | { phase: "offer" }
  | { phase: "protecting" }
  /** The one-time phrase, shown before the import it was created for. */
  | { phase: "revealing"; phrase: string }
  | { phase: "working" }
  | { phase: "denied" }
  | { phase: "error"; message: string }
  | {
      phase: "done";
      result: ImportResult;
      access: Access;
      promptSelf: boolean;
    };

export default function ImportScreen() {
  const core = useCore();
  const account = useAccount();
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "checking" });
  // Gates the import: set by answering the offer, or when there is none.
  const [importing, setImporting] = useState(false);

  function startImport() {
    setState({ phase: "working" });
    setImporting(true);
  }

  // An account's store is already encrypted, so there is nothing to offer.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const status = await account.status();
        if (!live) return;
        if (status.hasAccount) startImport();
        else setState({ phase: "offer" });
      } catch {
        // A failed custody read must not strand the user: import anyway.
        if (live) startImport();
      }
    })();
    return () => {
      live = false;
    };
  }, [account]);

  useEffect(() => {
    if (!importing) return;
    let live = true;
    // Every run that lands while this is up counts, since a background run
    // tends to get there first.
    const landed: ImportResult = { created: 0, skipped: 0, errors: [] };
    const stopObserving = observeDeviceContactSync((run) => {
      landed.created += run.created;
      landed.skipped += run.skipped;
      landed.errors.push(...run.errors);
    });
    void (async () => {
      try {
        const before = await getPermissionsAsync();
        const permission = before.granted
          ? before
          : await requestPermissionsAsync();
        if (!permission.granted) {
          if (live) setState({ phase: "denied" });
          return;
        }
        const access: Access =
          permission.accessPrivileges === "limited" ? "limited" : "all";
        // Under iOS's limited access nothing asks again, so a return visit
        // offers the system picker to share more.
        if (before.granted && access === "limited" && Platform.OS === "ios") {
          await Contact.presentAccessPicker().catch(() => []);
        }
        await core.deviceContacts.setSyncEnabled(true);
        // Queued, so once this resolves every earlier run has reported.
        await syncDeviceContacts(core);
        stopObserving();
        const result = { ...landed, errors: [...landed.errors] };
        // Offer to pick yourself once people landed and no self is set.
        const self = await core.self.get().catch(() => undefined);
        if (live) {
          setState({
            phase: "done",
            result,
            access,
            promptSelf: result.created > 0 && self === undefined,
          });
        }
      } catch (cause) {
        if (live) setState({ phase: "error", message: String(cause) });
      }
    })();
    return () => {
      live = false;
      stopObserving();
    };
  }, [core, importing]);

  /** Leave, landing on the duplicates review if the import made any. */
  async function finish(result: ImportResult) {
    const outstanding =
      result.created > 0 ? await core.duplicates.count().catch(() => 0) : 0;
    // The review is a root-stack screen and replaces this one; People & Pets
    // is in the tabs underneath, so we drop back to it.
    if (outstanding > 0) router.replace("/duplicates");
    else router.dismissTo("/people");
  }

  if (state.phase === "checking" || state.phase === "working") {
    return (
      <Screen title="Import from Contacts">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (state.phase === "offer") {
    return (
      <Screen title="Import from Contacts">
        <Text style={styles.rowText}>
          Your contacts are about to be written to this device. Right now
          nothing here is encrypted — setting up a login encrypts it first, so
          they land protected rather than in the clear.
        </Text>
        {/* Promises access, not safety: an account does nothing for a lost
            phone. */}
        <Text style={styles.muted}>
          It takes a minute and nothing is sent anywhere. You can do it later
          from Settings instead, but the contacts imported before then will have
          been written unencrypted.
        </Text>
        <Pressable
          testID="import-protect-first"
          accessibilityRole="button"
          style={[styles.button, styles.buttonBlock]}
          onPress={() => setState({ phase: "protecting" })}
        >
          <Text style={styles.buttonText}>Encrypt my data first</Text>
        </Pressable>
        {/* Named for its consequence, not softened into "skip". */}
        <Pressable
          testID="import-without-protecting"
          accessibilityRole="button"
          style={[styles.buttonSecondary, styles.buttonBlock]}
          onPress={startImport}
        >
          <Text style={styles.buttonSecondaryText}>
            Import without encrypting
          </Text>
        </Pressable>
      </Screen>
    );
  }

  if (state.phase === "protecting") {
    return (
      <>
        <Stack.Screen options={{ title: "Encrypt your data" }} />
        <ScrollView contentContainerStyle={styles.screen}>
          <CreateAccountForm
            onCreated={(phrase) => setState({ phase: "revealing", phrase })}
          />
        </ScrollView>
      </>
    );
  }

  if (state.phase === "revealing") {
    return (
      <>
        <Stack.Screen
          options={{ title: "Encrypt your data", headerBackVisible: false }}
        />
        <RecoveryKeyReveal recoveryKey={state.phrase} onDone={startImport} />
      </>
    );
  }

  if (state.phase === "denied") {
    return (
      <Screen title="Import from Contacts">
        <Text style={styles.rowText}>
          Leapsake needs permission to read your contacts to import them.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => void Linking.openSettings()}
        >
          <Text style={styles.buttonText}>Open Settings</Text>
        </Pressable>
        {/* A refusal must not end the first-run path: adding by hand. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/add")}
        >
          <Text style={styles.link}>Or add someone by hand</Text>
        </Pressable>
      </Screen>
    );
  }

  if (state.phase === "error") {
    return (
      <Screen title="Import from Contacts">
        <Text style={styles.danger}>{state.message}</Text>
      </Screen>
    );
  }

  const { result, access, promptSelf } = state;
  return (
    <Screen title="Import complete" hideBack>
      <Text style={styles.rowText}>
        {result.created > 0
          ? `Imported ${result.created} ${result.created === 1 ? "person" : "people"}.`
          : "No new contacts to import."}
      </Text>
      {result.skipped > 0 && (
        <Text style={styles.muted}>
          Left out {result.skipped} with no name, like businesses.
        </Text>
      )}
      <Text style={styles.muted}>
        {access === "all"
          ? "People you add to your phone’s contacts will show up here on their own."
          : "Leapsake only sees the contacts you chose to share. To share more, come back here."}
      </Text>
      {result.errors.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={styles.danger}>
            Couldn’t import {result.errors.length}:
          </Text>
          {/* Keyed by position: `err.index` is per run, and this list can
              hold more than one run's. */}
          {result.errors.map((err, i) => (
            <Text key={i} style={styles.muted}>
              • {err.contact.displayName ?? "Unnamed contact"} — {err.message}
            </Text>
          ))}
        </View>
      )}
      {promptSelf && (
        <View style={{ gap: 8 }}>
          <Text style={styles.rowText}>Which of these is you?</Text>
          {/* `replace`: /about-you is a root-stack screen, standing in for
              this one. */}
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => router.replace("/about-you")}
          >
            <Text style={styles.buttonText}>Pick yourself</Text>
          </Pressable>
        </View>
      )}
      {/* The one way off, Back being withheld: Back would skip the
          duplicates review. */}
      <Pressable
        accessibilityRole="button"
        // Secondary once the self prompt is up, so "Pick yourself" leads.
        style={[
          promptSelf ? styles.buttonSecondary : styles.button,
          styles.buttonBlock,
        ]}
        onPress={() => void finish(result)}
      >
        <Text
          style={promptSelf ? styles.buttonSecondaryText : styles.buttonText}
        >
          Done
        </Text>
      </Pressable>
    </Screen>
  );
}

/** A container for each state; only the finished one hides Back. */
function Screen({
  title,
  hideBack = false,
  children,
}: {
  title: string;
  hideBack?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title, headerBackVisible: !hideBack }} />
      {children}
    </View>
  );
}
