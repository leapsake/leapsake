import { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  type ContactMethod,
  formatPostalAddress,
  postalAddressLines,
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
import { deleteContact } from "../lib/contact-writes";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * A glyph per verb. These are the row's buttons as well as the sheet's bullets:
 * one glyph means one thing to do wherever it appears, so 📞 on a row and 📞 in
 * the sheet both place a call.
 */
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

/**
 * Which of a row's actions get a button of their own, in the resolver's order —
 * so the leading button is the likeliest thing to do with that method.
 *
 * Two things are held back to the `⋯` sheet. Copy, because it is about the
 * string rather than the person, and a row of ways to reach someone shouldn't
 * spend a button on not reaching them. And any action whose glyph a button
 * already carries: a number that is also on WhatsApp resolves to two 💬 actions,
 * and two identical buttons side by side is a coin toss, not a choice. The first
 * one wins because the resolver already ranked them.
 */
function buttonActions(actions: readonly LinkAction[]): LinkAction[] {
  const taken = new Set<string>();
  return actions.filter((action) => {
    if (action.verb === "copy") return false;
    const glyph = VERB_ICON[action.verb];
    if (taken.has(glyph)) return false;
    taken.add(glyph);
    return true;
  });
}

/** Put a value on the clipboard and say so — the last rung of the fallback chain. */
async function copyToClipboard(text: string) {
  await Clipboard.setStringAsync(text);
  Alert.alert(COPIED);
}

/**
 * The value as the row displays it — the same string as {@link methodValue}
 * everywhere except a postal address, which breaks onto envelope lines so that
 * "Springfield, IL 62704" reads as a place rather than as three more
 * comma-separated fragments of one long line.
 *
 * Kept apart from `methodValue` because that string still has to be one line:
 * it titles the action sheet, fills the "Call Jane?" confirm, and is what a
 * copy falls back to.
 */
function displayValue(entry: ContactMethod): string {
  if (entry.kind === "postal")
    return postalAddressLines(entry.method).join("\n");
  return methodValue(entry);
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
 * Each row carries its actions as trailing glyph buttons — 💬 and 📞 on a
 * mobile, ✉️ on an email, 🗺️ on a postal address — so what a row can do is
 * visible without tapping it to find out. Those glyphs used to sit *left* of the
 * label as a per-kind decoration, which spent the row's most useful position
 * saying something the label and value already said. The row body stays pressable
 * for the likeliest action, and the `⋯` opens {@link ContactActionSheet} with
 * everything the buttons hold back (see {@link buttonActions}).
 *
 * The sheet ends in **Edit** and **Remove**, which is where changing a row
 * belongs on a page whose rows are otherwise things to do: they are the only two
 * items about the record rather than about the person, so they sit last and
 * Remove wears the danger colour. Putting them in the sheet rather than in the
 * row is also what freed the row body to be the tap that calls.
 *
 * Which actions exist is decided by `@leapsake/contact-links`, which is pure and
 * shared; which of them this handset can actually perform is decided by
 * `lib/contact-actions.ts`. This file only renders the answer and calls
 * `Linking`. Contacts are person-owned only, so there is no subject-type axis.
 */
export function ContactsSection({
  ownerId,
  subjectName,
  methods,
  onChanged,
}: {
  /** The person these belong to, for the add/edit routes and the removals. */
  ownerId: string;
  /** Who the methods belong to, for the "Call Jane?" confirm. */
  subjectName: string;
  methods: ContactMethod[];
  /** Refetch the page — a removal writes in place, with nothing to navigate to. */
  onChanged: () => void;
}) {
  const core = useCore();
  const router = useRouter();
  const schemes = useSupportedSchemes();
  const [openFor, setOpenFor] = useState<string | null>(null);

  function confirmRemove(entry: ContactMethod) {
    Alert.alert("Remove contact", `Remove ${entry.method.label}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          deleteContact(core, entry.method.id, entry.kind).then(
            () => onChanged(),
            (e: unknown) => Alert.alert("Couldn't remove", String(e)),
          );
        },
      },
    ]);
  }

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
    return [
      ...actions.map((action) => ({
        key: action.id,
        glyph: VERB_ICON[action.verb],
        label: actionLabel(action),
        // Said only where a link lands somewhere other than a conversation, so
        // the row never implies a DM it cannot open.
        hint: action.reach === "profile" ? PROFILE_HINT : undefined,
        onPress: () => perform(action, entry),
      })),
      {
        key: "edit",
        glyph: "✏️",
        label: "Edit",
        onPress: () =>
          router.push(`/people/${ownerId}/contacts/${entry.method.id}/edit`),
      },
      {
        key: "remove",
        glyph: "🗑️",
        label: "Remove",
        danger: true,
        onPress: () => confirmRemove(entry),
      },
    ];
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Contact</Text>
        {/* One way in, not four. The header used to offer Email / Phone /
            Postal / Social side by side, which asked the user to classify what
            they were about to type before they had typed it; the form's own
            Type dropdown asks the same question in the place where the answer
            is about to matter. */}
        <Link
          href={`/people/${ownerId}/contacts/new`}
          style={styles.link}
          accessibilityRole="button"
        >
          Add contact method
        </Link>
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
                {/* The row body *is* the primary action, and now says so as a
                    hint rather than a label: the label is the method itself, so
                    a screen reader reads the number out — it used to announce
                    "Text — Mobile" and swallow the value entirely — and doesn't
                    read the same words twice for the row and its 💬 button. A
                    method with nothing to offer (a blank address) stays a plain,
                    unpressable row rather than a control that does nothing. */}
                <Pressable
                  accessibilityRole={primary ? "button" : undefined}
                  accessibilityLabel={`${entry.method.label}, ${value}`}
                  accessibilityHint={primary ? actionLabel(primary) : undefined}
                  disabled={primary === undefined}
                  onPress={() => primary && perform(primary, entry)}
                  style={styles.rowBody}
                >
                  <Text style={styles.rowText}>{entry.method.label}</Text>
                  <Text style={styles.muted}>{displayValue(entry)}</Text>
                </Pressable>
                {buttonActions(actions).map((action) => (
                  <Pressable
                    key={action.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${actionLabel(action)} — ${entry.method.label}`}
                    onPress={() => perform(action, entry)}
                    // Vertical only: neighbouring buttons are a thumb-width
                    // apart already, and horizontal slop would have each one
                    // reaching into the next.
                    hitSlop={{ top: 10, bottom: 10 }}
                    style={local.action}
                  >
                    <Text style={local.actionGlyph}>
                      {VERB_ICON[action.verb]}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`More actions for ${entry.method.label}`}
                  onPress={() => setOpenFor(entry.method.id)}
                  hitSlop={{ top: 10, bottom: 10, right: 12 }}
                  style={local.action}
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

const local = StyleSheet.create({
  /** Sized to a tap, not to the glyph: the emoji is small, the target isn't. */
  action: {
    minWidth: 32,
    paddingVertical: 2,
    alignItems: "center",
  },
  actionGlyph: {
    fontSize: 20,
  },
});
