import { Pressable, Text, View } from "react-native";
import type { ContactMethod, ContactMethodKind } from "@leapsake/schema";
import {
  type ContactDraft,
  ContactMethodFields,
  contactDraftFilled,
  contactDraftFrom,
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
 * A contact method being authored on a form: the draft the write will use, a key
 * to address the row by, and — on the edit screen — the id of the method it was
 * read back from. See {@link StagedMilestone}, which is the same idea for the
 * same reasons; a contact has no forward reference to satisfy, so its key is only
 * ever a React key.
 */
export interface StagedContact {
  key: string;
  draft: ContactDraft;
  /** The saved method this row came from; absent on a row added to the form. */
  savedId?: string;
  /** Whether it has been typed into here — see {@link StagedMilestone}. */
  edited?: boolean;
}

/** A saved contact method as a staged row. */
export function stagedContactOf(entry: ContactMethod): StagedContact {
  return {
    key: entry.method.id,
    savedId: entry.method.id,
    draft: contactDraftFrom(entry),
  };
}

/**
 * A row added here that still has nothing in it — the "Add contact method" tap
 * nobody followed through on. It is neither written nor allowed to hold up the
 * Save: an empty row is a question the user declined to answer, and a form that
 * refused to save until you noticed and removed it would be punishing a stray
 * tap. A row seeded from a saved method is never pending — blanking a stored
 * email is not how you delete it, so that stays an invalid form.
 */
export function contactRowPending(row: StagedContact): boolean {
  return row.savedId === undefined && !contactDraftFilled(row.draft);
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function contactRowValid(row: StagedContact): boolean {
  return contactRowPending(row) || contactDraftValid(row.draft);
}

/**
 * Contact methods on the **create** and **edit** screens — held in an array until
 * the form is saved, then written through the same `core.contactMethods.*` calls.
 * See {@link StagedMilestonesSection} for why staging works this way; the
 * counterpart on the Person screen is {@link ContactsSection}, which is a list of
 * ways to reach somebody rather than a place to revise them.
 *
 * Person-only, like the section it mirrors: a pet has no Contacts section on its
 * detail page, so offering one would promise a place to read it back that doesn't
 * exist. Neither entity form renders this for a pet.
 *
 * **Every row is open.** A stored email is a text field you retype, the same as
 * the name at the top of the screen — not a summary line behind an Edit that
 * opened a form, took a second Save, and asked the user to believe the two Saves
 * meant different things. Nothing is written any sooner for it: the row edits its
 * draft, and the form's one Save writes the difference.
 *
 * "Add contact method" appends a row rather than opening a sub-form, and the row
 * carries the Type dropdown that a saved one doesn't — a single entry point,
 * rather than four in the header that asked the user to classify what they were
 * about to type before they had typed it. Removing likewise only takes the row
 * out of the list.
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
          {/* What the row is, next to the way out of it. On a row being added
              the Type dropdown below says the same thing and is the place to
              change it; this line is what a saved row has instead. */}
          <View style={styles.sectionHeader}>
            <Text style={styles.fieldLabel}>
              {KIND_HEADING[entry.draft.kind]}
            </Text>
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
            draft={entry.draft}
            canChangeKind={entry.savedId === undefined}
            onChange={(draft) =>
              onChange(
                entries.map((e) =>
                  e.key === entry.key ? { ...e, draft, edited: true } : e,
                ),
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
