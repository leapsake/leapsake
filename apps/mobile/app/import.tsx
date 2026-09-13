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
import { useCore, useSync } from "../lib/core-context";
import {
  CreateAccountForm,
  RecoveryKeyReveal,
} from "../components/ProtectData";
import { styles } from "../lib/styles";

/**
 * Import from Contacts — asks for the address book, brings in everyone it can
 * see, and from then on keeps bringing in new contacts on its own
 * (`lib/device-contacts-sync.ts`, which has the rules).
 *
 * There is no checklist of our own. The system's permission prompt already asks
 * the question — share everything, or pick — and a second list after it asked it
 * twice. Somebody who brings in more people than they wanted removes them; a
 * removed person stays removed.
 *
 * Duplicates are left to the review after the import (see {@link finish}) rather
 * than flagged beforehand: it merges the two records, where a pre-import warning
 * could only offer to leave the contact out.
 *
 * ## The protect offer comes first *(2026-09-13)*
 *
 * An accountless store is **plaintext by design** (`encryption/model.md` §7.2), and
 * this screen is the single largest write the app ever makes to it — an entire
 * address book. Importing first and offering encryption afterwards was the shape
 * the onboarding nudges used to guarantee, and it is the wrong way round twice
 * over: the whole list lands in the clear, and the conversion that follows cannot
 * scrub those bytes out of free space (`model.md` §12). So a device with no account
 * is asked here, before a single contact is read.
 *
 * ⚠️ **It is an offer, not a wall.** *Import without protecting* is right there and
 * costs one tap, because nothing may stand between opening the app and using it
 * (`model.md` §7). The offer is the opinionated default; the skip is what keeps it
 * a default rather than a gate.
 */

type Access = "all" | "limited";

type State =
  /** Reading custody before anything else — the offer below depends on it. */
  | { phase: "checking" }
  /** No account: offer to encrypt this device before the address book lands. */
  | { phase: "offer" }
  | { phase: "protecting" }
  /** The one-time phrase, which every caller of the form owes the user. */
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
  const sync = useSync();
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "checking" });
  // Gates the import effect below. Set by taking or declining the offer, and by
  // the custody check when there is no offer to make.
  const [importing, setImporting] = useState(false);

  function startImport() {
    setState({ phase: "working" });
    setImporting(true);
  }

  // Which side of the offer this visit falls on. A store that already holds an
  // account is encrypted, so there is nothing to ask and the import starts as it
  // always did.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const status = await sync.status();
        if (!live) return;
        if (status.hasAccount) startImport();
        else setState({ phase: "offer" });
      } catch {
        // A custody read that fails must not strand the user on a screen they
        // came here to use. Falling through to the import is the same behaviour
        // this screen had before the offer existed.
        if (live) startImport();
      }
    })();
    return () => {
      live = false;
    };
  }, [sync]);

  useEffect(() => {
    if (!importing) return;
    let live = true;
    // Everything that lands while this screen is up is this import's result,
    // not only its own run's: see `observeDeviceContactSync` for the background
    // run that tends to get there first.
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
        // The first time, iOS's own prompt has just asked who to share. On a
        // later visit under limited access nothing would ask again, and coming
        // back here is how somebody shares more — so offer the system picker.
        if (before.granted && access === "limited" && Platform.OS === "ios") {
          await Contact.presentAccessPicker().catch(() => []);
        }
        await core.deviceContacts.setSyncEnabled(true);
        // Queued behind any run already going, so once this resolves every run
        // that could have taken these contacts has reported to `landed`.
        await syncDeviceContacts(core);
        stopObserving();
        const result = { ...landed, errors: [...landed.errors] };
        // Import is a natural prompt point for the self-person, mirroring
        // desktop's ImportReview: offer it only when people actually landed and
        // no self is set yet — there's now a list to pick from.
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

  /**
   * Leave the import. Nothing checked the contacts against people who already
   * existed, or against each other, before they were written — so once they are,
   * ask the detector and land on the review if it has anything. Unscoped: one
   * import can implicate many people at once. Mirrors desktop's ImportReview
   * `finish`.
   */
  async function finish(result: ImportResult) {
    const outstanding =
      result.created > 0 ? await core.duplicates.count().catch(() => 0) : 0;
    // Two different moves, because the two destinations live in different
    // navigators: the review is another root-stack screen, so it replaces this
    // one; People & Pets is in the tab navigator underneath, so we drop back to
    // it rather than stacking a second copy of the tabs on top.
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
        {/* Promise access, not safety — the same line the form itself takes. An
            account protects against this device losing its security settings; it
            does nothing about a lost or broken phone. */}
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
          <Text style={styles.buttonText}>Protect my data first</Text>
        </Pressable>
        {/* Named for what it does rather than softened into "skip", because it is
            the choice with a consequence and the user is entitled to read it. */}
        <Pressable
          testID="import-without-protecting"
          accessibilityRole="button"
          style={[styles.buttonSecondary, styles.buttonBlock]}
          onPress={startImport}
        >
          <Text style={styles.buttonSecondaryText}>
            Import without protecting
          </Text>
        </Pressable>
      </Screen>
    );
  }

  if (state.phase === "protecting") {
    return (
      <>
        <Stack.Screen options={{ title: "Protect your data" }} />
        <ScrollView contentContainerStyle={styles.screen}>
          <CreateAccountForm
            onCreated={(phrase) => setState({ phase: "revealing", phrase })}
          />
        </ScrollView>
      </>
    );
  }

  // The phrase is shown exactly once and is never derivable again, so this stands
  // between creating the account and the import it was created for.
  if (state.phase === "revealing") {
    return (
      <>
        <Stack.Screen
          options={{ title: "Protect your data", headerBackVisible: false }}
        />
        <RecoveryKeyReveal
          recoveryKey={state.phrase}
          escrowPending={false}
          onDone={startImport}
        />
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
        {/* The way on for someone who is not going to grant it. This screen is
            where the first-run nudge sends people, so a refusal here would
            otherwise end the only path the app had offered them. Adding by hand
            is a complete answer to "get started", and the two screens link to
            each other rather than one way. */}
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
          {/* `replace`, not `dismissTo`: /about-you is another root-stack
              screen, so it stands in for this one rather than dropping back to
              the tabs. Its typeahead is the point at this exact moment — the
              list behind it is hundreds of names long and you know your own. */}
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => router.replace("/about-you")}
          >
            <Text style={styles.buttonText}>Pick yourself</Text>
          </Pressable>
        </View>
      )}
      {/* The one way off this screen, the header's Back being withheld here (see
          {@link Screen}). They were two controls for one decision and only this
          one does the work: it asks the detector what the import implicated and
          lands on the review, where Back would drop the user wherever they
          happened to arrive from and leave the duplicates unseen.

          A **button** in both states rather than a bare word in one. The quiet
          style is what lets "Pick yourself" lead without demoting this to a link
          nobody is sure is tappable — and it is now the only way out, which a
          link is the wrong shape for. */}
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

/**
 * A simple container for each of the screen's states.
 *
 * `hideBack` is how the finished state ends up with exactly one way out — see
 * the Done button above. Every **other** state keeps Back, and must: none of
 * them offers a way on, so a screen you could not leave is a worse bargain than
 * a redundant control.
 */
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
