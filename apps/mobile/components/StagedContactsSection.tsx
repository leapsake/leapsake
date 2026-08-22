import { Pressable, Text, View } from "react-native";
import type { ContactMethodKind } from "@leapsake/schema";
import { findPlatform } from "@leapsake/contact-links";
import {
  type ContactDraft,
  ContactMethodFields,
  contactDraftFilled,
  contactDraftValid,
  emptyContactDraft,
} from "./ContactMethodFields";
import { styles } from "../lib/styles";

/** What each row calls itself, mirroring {@link ContactsSection}'s glyphs. */
const KIND_HEADING: Record<ContactMethodKind, string> = {
  email: "✉️ Email",
  phone: "📞 Phone",
  postal: "🏠 Postal address",
  social: "💬 Social",
};

/**
 * A row's heading. A social row says which platform, since that is now what the
 * user picked it as — an unknown id shown as stored, the same call
 * {@link ContactsSection} makes — and falls back to "Social" only while the
 * catch-all is waiting to be told.
 */
function headingFor(draft: ContactDraft): string {
  if (draft.kind !== "social") return KIND_HEADING[draft.kind];
  const named = findPlatform(draft.platform)?.name ?? draft.platform.trim();
  return named === "" ? KIND_HEADING.social : `💬 ${named}`;
}

/**
 * A contact method being authored on the create form: the draft the write will
 * use, plus a key to address the row by. See {@link StagedMilestone}, which is
 * the same idea for the same reasons; a contact has no forward reference to
 * satisfy, so its key is only ever a React key.
 */
export interface StagedContact {
  key: string;
  draft: ContactDraft;
}

/**
 * A row that still has nothing in it — the "Add contact method" tap nobody
 * followed through on. It is neither written nor allowed to hold up the Save: an
 * empty row is a question the user declined to answer, and a form that refused
 * to save until you noticed and removed it would be punishing a stray tap.
 */
export function contactRowPending(row: StagedContact): boolean {
  return !contactDraftFilled(row.draft);
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function contactRowValid(row: StagedContact): boolean {
  return contactRowPending(row) || contactDraftValid(row.draft);
}

/**
 * Contact methods on the **create** screen — held in an array until the form is
 * saved, then written through `core.contactMethods.*`. See
 * {@link StagedMilestonesSection} for why staging works this way; the
 * counterpart on the Person screen is {@link ContactsSection}, where a saved
 * method is added and revised one at a time on a screen of its own.
 *
 * Person-only, like the section it mirrors: a pet has no Contacts section on its
 * detail page, so offering one would promise a place to read it back that doesn't
 * exist.
 *
 * **Every row is open**, and stays a row rather than becoming a sub-form with a
 * Save of its own — that Save would have to mean something different from the
 * form's, and nothing would be written any sooner for it. "Add contact method"
 * appends a row; removing takes one out. Both are only edits to the list until
 * the form is saved.
 */
export function StagedContactsSection({
  entries,
  onChange,
}: {
  entries: StagedContact[];
  onChange: (entries: StagedContact[]) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Contact</Text>
      </View>

      {entries.map((entry) => (
        <View key={entry.key} style={[styles.row, styles.inlineForm]}>
          {/* What the row is so far, next to the way out of it — the only line
              that says which method's Remove this is. */}
          <View style={styles.sectionHeader}>
            <Text style={styles.fieldLabel}>{headingFor(entry.draft)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.draft.label}`}
              onPress={() =>
                onChange(entries.filter((e) => e.key !== entry.key))
              }
            >
              <Text style={[styles.link, styles.danger]}>Remove</Text>
            </Pressable>
          </View>
          <ContactMethodFields
            canChangeKind
            draft={entry.draft}
            onChange={(draft) =>
              onChange(
                entries.map((e) => (e.key === entry.key ? { ...e, draft } : e)),
              )
            }
          />
        </View>
      ))}

      {entries.length === 0 ? (
        <Text style={styles.muted}>No contact methods yet.</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          onChange([
            ...entries,
            { key: crypto.randomUUID(), draft: emptyContactDraft() },
          ])
        }
      >
        <Text style={styles.link}>Add contact method</Text>
      </Pressable>
    </View>
  );
}
