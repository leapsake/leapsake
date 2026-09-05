import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { type ContactMethod, postalAddressLines } from "@leapsake/schema";
import { type LinkAction, resolveActions } from "@leapsake/contact-links";
import { ContactActionSheet, type SheetItem } from "./ContactActionSheet";
import {
  VERB_ICON,
  actionLabel,
  buttonActions,
  offeredActions,
} from "../lib/contact-actions";
import { methodValue, useContactReach } from "../lib/use-contact-reach";
import { deleteContact } from "../lib/contact-writes";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

const PROFILE_HINT = "profile";
const MORE = "⋯";

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
  const { schemes, perform } = useContactReach(subjectName);
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
