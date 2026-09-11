import { type ReactNode, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
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
import { syncDeviceContacts } from "../lib/device-contacts-sync";
import { useCore } from "../lib/core-context";
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
 */

type Access = "all" | "limited";

type State =
  | { phase: "working" }
  | { phase: "denied" }
  | { phase: "error"; message: string }
  | {
      phase: "done";
      result: ImportResult;
      access: Access;
      promptSelf: boolean;
    };

const NOTHING_NEW: ImportResult = { created: 0, skipped: 0, errors: [] };

export default function ImportScreen() {
  const core = useCore();
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "working" });

  useEffect(() => {
    let live = true;
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
        const result = (await syncDeviceContacts(core)) ?? NOTHING_NEW;
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
    };
  }, [core]);

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

  if (state.phase === "working") {
    return (
      <Screen title="Import from Contacts">
        <ActivityIndicator />
      </Screen>
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
    <Screen title="Import complete">
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
          {result.errors.map((err) => (
            <Text key={err.index} style={styles.muted}>
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
      <Pressable
        accessibilityRole="button"
        // Secondary once the self prompt is up, so "Pick yourself" leads.
        style={promptSelf ? undefined : styles.button}
        onPress={() => void finish(result)}
      >
        <Text style={promptSelf ? styles.link : styles.buttonText}>Done</Text>
      </Pressable>
    </Screen>
  );
}

/** A simple container for each of the screen's states. */
function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      {children}
    </View>
  );
}
