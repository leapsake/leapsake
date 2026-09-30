import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { type ContactMethod, postalAddressLines } from "@leapsake/schema";
import { type LinkAction, resolveActions } from "@leapsake/contact-links";
import type { SheetItem } from "./ActionSheet";
import { RowMenu, rowMenuItem } from "./RowMenu";
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

/**
 * {@link methodValue}, but a postal address breaks onto envelope lines; the
 * one-line form still titles the sheet and fills the confirm.
 */
function displayValue(entry: ContactMethod): string {
  if (entry.kind === "postal")
    return postalAddressLines(entry.method).join("\n");
  return methodValue(entry);
}

/**
 * A person's contact methods as ways to reach them: glyph buttons per row, the
 * body its likeliest action, and `⋯` for the rest, ending in Edit and Remove.
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
  /** Refetch the page after a removal, which has nowhere to navigate to. */
  onChanged: () => void;
}) {
  const core = useCore();
  const router = useRouter();
  const { schemes, region, perform } = useContactReach(subjectName);

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
      rowMenuItem.edit(() =>
        router.push(`/people/${ownerId}/contacts/${entry.method.id}/edit`),
      ),
      rowMenuItem.remove(() => confirmRemove(entry)),
    ];
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Contact</Text>
        {/* One way in: the form's Type dropdown asks what kind. */}
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
          const actions = offeredActions(
            resolveActions(entry, { region }),
            schemes,
          );
          const primary = actions[0];
          const value = methodValue(entry);
          return (
            <View key={entry.method.id} style={styles.row}>
              <View style={styles.rowWithLead}>
                {/* The action is a hint, not the label, so the value is read
                    out. With no action the row is not pressable. */}
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
                    // Vertical only, or neighbouring buttons would overlap.
                    hitSlop={{ top: 10, bottom: 10 }}
                    style={local.action}
                  >
                    <Text style={local.actionGlyph}>
                      {VERB_ICON[action.verb]}
                    </Text>
                  </Pressable>
                ))}
                <RowMenu
                  subject={entry.method.label}
                  title={`${entry.method.label} · ${value}`}
                  items={sheetItems(entry, actions)}
                />
              </View>
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
