import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  type ContactMethod,
  type ContactMethodKind,
  formatPostalAddress,
} from "@leapsake/schema";
import {
  type LinkAction,
  NATIVE_SCHEMES,
  SCHEME_PROBES,
  findPlatform,
  resolveActions,
} from "@leapsake/contact-links";
import { ContactActionSheet, type SheetItem } from "./ContactActionSheet";
import { offeredActions, targetUrl } from "../lib/contact-actions";
import { styles } from "../lib/styles";

/** A glyph per kind, mirroring the desktop section's leading icon. */
const KIND_ICON: Record<ContactMethodKind, string> = {
  email: "✉️",
  phone: "📞",
  postal: "🏠",
  social: "💬",
};

/** A glyph per verb, so the sheet reads as a list of actions rather than links. */
const VERB_ICON: Record<LinkAction["verb"], string> = {
  text: "💬",
  call: "📞",
  video: "🎥",
  email: "✉️",
  map: "🗺️",
  chat: "💬",
  open: "↗️",
  copy: "📋",
};

const COPIED = "Copied";
const PROFILE_HINT = "profile";
const MORE = "⋯";

/**
 * What each verb is called. Platform actions get their proper noun folded in —
 * "Message on WhatsApp", "Open in Instagram" — because the verb alone would not
 * say which of a row's several links a sheet item is.
 */
function actionLabel(action: LinkAction): string {
  switch (action.verb) {
    case "text":
      return "Text";
    case "call":
      return "Call";
    case "video":
      return "FaceTime";
    case "email":
      return "Send email";
    case "map":
      return "Open in Maps";
    case "copy":
      return "Copy";
    case "chat":
      return action.name === undefined
        ? "Send a message"
        : `Message on ${action.name}`;
    case "open":
      return action.name === undefined ? "Open link" : `Open in ${action.name}`;
  }
}

/** Put a value on the clipboard and say so — the last rung of the fallback chain. */
async function copyToClipboard(text: string) {
  await Clipboard.setStringAsync(text);
  Alert.alert(COPIED);
}

/** The one-line value shown under each method's label. */
function methodValue(entry: ContactMethod): string {
  if (entry.kind === "email") return entry.method.address;
  if (entry.kind === "phone") {
    const ext = entry.method.extension ? ` ext. ${entry.method.extension}` : "";
    const noSms = entry.method.smsCapable ? "" : " (no texts)";
    return entry.method.number + ext + noSms;
  }
  if (entry.kind === "social") {
    // The platform's proper noun beside the handle, so a bare "@josh" says which
    // "@josh". An unknown platform id is shown as stored rather than hidden —
    // the point of an open list is that a row outlives this build's knowledge.
    const { platform, handle, url } = entry.method;
    const name = findPlatform(platform)?.name ?? platform;
    return handle === "" ? (url ?? name) : `${name} · ${handle}`;
  }
  return formatPostalAddress(entry.method);
}

/**
 * Which custom schemes this handset actually answers.
 *
 * Probed once per mount rather than per row: a person may have a dozen contact
 * methods but there are only ever two schemes, and `canOpenURL` is a bridge
 * call. Starts empty, so an action with no web fallback (FaceTime) appears a
 * frame late rather than appearing and then vanishing — of the two, a control
 * that arrives is less alarming than one that leaves.
 */
function useSupportedSchemes(): ReadonlySet<string> {
  const [schemes, setSchemes] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void Promise.all(
      NATIVE_SCHEMES.map(async (scheme) => {
        const ok = await Linking.canOpenURL(SCHEME_PROBES[scheme]).catch(
          // A rejected probe means "no", not a broken screen: iOS throws for a
          // scheme missing from LSApplicationQueriesSchemes, which is precisely
          // the case where we must not offer the action.
          () => false,
        );
        return { scheme, ok };
      }),
    ).then((results) => {
      if (!alive) return;
      setSchemes(new Set(results.filter((r) => r.ok).map((r) => r.scheme)));
    });
    return () => {
      alive = false;
    };
  }, []);

  return schemes;
}

/**
 * The Contacts section on the Person detail screen: a person's merged contact
 * methods, each one a **way to reach them** rather than a string to read.
 *
 * Tapping a row runs its likeliest action — text a mobile, mail an address, open
 * a profile — and the `⋯` beside it opens {@link ContactActionSheet} with the
 * rest. The sheet used to end in Edit and Remove; those went to the form behind
 * the page's Edit ({@link StagedContactsSection}) along with every other way of
 * changing this record, leaving the sheet as a list of things to *do* with a
 * number rather than things to do to it.
 *
 * Which actions exist is decided by `@leapsake/contact-links`, which is pure and
 * shared; which of them this handset can actually perform is decided by
 * `lib/contact-actions.ts`. This file only renders the answer and calls
 * `Linking`. Contacts are person-owned only, so there is no subject-type axis.
 */
export function ContactsSection({
  subjectName,
  methods,
}: {
  /** Who the methods belong to, for the "Call Jane?" confirm. */
  subjectName: string;
  methods: ContactMethod[];
}) {
  const schemes = useSupportedSchemes();
  const [openFor, setOpenFor] = useState<string | null>(null);

  /** Run an action: open its best URL, or fall back to the clipboard. */
  function perform(action: LinkAction, entry: ContactMethod) {
    const url = targetUrl(action, schemes);
    if (url === null) {
      void copyToClipboard(action.copyText ?? methodValue(entry));
      return;
    }
    const open = () =>
      Linking.openURL(url).catch((e: unknown) =>
        Alert.alert("Couldn't open", String(e)),
      );

    // The one action that interrupts somebody, so the one that asks first.
    if (action.confirm) {
      Alert.alert(`Call ${subjectName}?`, methodValue(entry), [
        { text: "Cancel", style: "cancel" },
        { text: "Call", onPress: () => void open() },
      ]);
      return;
    }
    void open();
  }

  function sheetItems(
    entry: ContactMethod,
    actions: LinkAction[],
  ): SheetItem[] {
    return actions.map((action) => ({
      key: action.id,
      glyph: VERB_ICON[action.verb],
      label: actionLabel(action),
      // Said only where a link lands somewhere other than a conversation, so
      // the row never implies a DM it cannot open.
      hint: action.reach === "profile" ? PROFILE_HINT : undefined,
      onPress: () => perform(action, entry),
    }));
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Contact methods</Text>
      </View>

      {methods.length === 0 ? (
        <Text style={styles.muted}>No contact methods yet.</Text>
      ) : (
        methods.map((entry) => {
          const actions = offeredActions(resolveActions(entry), schemes);
          const primary = actions[0];
          const value = methodValue(entry);
          return (
            <View key={entry.method.id} style={styles.row}>
              <View style={styles.rowWithLead}>
                {/* The row body *is* the primary action. A method with nothing
                    to offer (a blank address) stays a plain, unpressable row
                    rather than a control that does nothing. */}
                <Pressable
                  accessibilityRole={primary ? "button" : undefined}
                  accessibilityLabel={
                    primary
                      ? `${actionLabel(primary)} — ${entry.method.label}`
                      : undefined
                  }
                  disabled={primary === undefined}
                  onPress={() => primary && perform(primary, entry)}
                  style={styles.rowBody}
                >
                  <Text style={styles.rowText}>
                    {KIND_ICON[entry.kind]} {entry.method.label}
                  </Text>
                  <Text style={styles.muted}>{value}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`More actions for ${entry.method.label}`}
                  onPress={() => setOpenFor(entry.method.id)}
                  hitSlop={12}
                >
                  <Text style={styles.link}>{MORE}</Text>
                </Pressable>
              </View>

              <ContactActionSheet
                visible={openFor === entry.method.id}
                title={`${entry.method.label} · ${value}`}
                items={sheetItems(entry, actions)}
                onClose={() => setOpenFor(null)}
              />
            </View>
          );
        })
      )}
    </View>
  );
}
