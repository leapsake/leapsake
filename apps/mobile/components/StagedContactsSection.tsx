import { Pressable, Text, View } from "react-native";
import type { ContactMethodKind } from "@leapsake/schema";
import {
  type ContactMethodDraft,
  contactMethodDraftFilled,
  contactMethodDraftOf,
  contactMethodDraftWithKind,
  contactMethodInputOf,
  findPlatform,
} from "@leapsake/contact-links";
import { ContactMethodFields } from "./ContactMethodFields";
import { styles } from "../lib/styles";

/** What each row calls itself, mirroring {@link ContactsSection}'s glyphs. */
const KIND_HEADING: Record<ContactMethodKind, string> = {
  email: "✉️ Email",
  phone: "📞 Phone",
  postal: "🏠 Postal address",
  social: "💬 Social",
};

/** A row's heading; a social row names its platform once it has one. */
function headingFor(draft: ContactMethodDraft): string {
  if (draft.kind !== "social") return KIND_HEADING[draft.kind];
  const named = findPlatform(draft.platform)?.name ?? draft.platform.trim();
  return named === "" ? KIND_HEADING.social : `💬 ${named}`;
}

/** A contact method being created on the form, keyed for React only. */
export interface StagedContact {
  key: string;
  draft: ContactMethodDraft;
}

/** An empty row, neither written nor holding up the Save: a stray tap. */
export function contactRowPending(row: StagedContact): boolean {
  return !contactMethodDraftFilled(row.draft);
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function contactRowValid(row: StagedContact): boolean {
  return contactRowPending(row) || contactMethodInputOf(row.draft).ok;
}

/**
 * Contact methods staged on the create form, person-only, every row open:
 * a Save of its own would mean something other than the form's.
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

      {entries.map((entry) => {
        const setDraft = (draft: ContactMethodDraft) =>
          onChange(
            entries.map((e) => (e.key === entry.key ? { ...e, draft } : e)),
          );
        return (
          <View key={entry.key} style={[styles.row, styles.inlineForm]}>
            {/* Says which method this Remove is for. */}
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
              onChange={setDraft}
              setKind={(kind, platform) =>
                setDraft(
                  contactMethodDraftWithKind(entry.draft, kind, platform),
                )
              }
            />
          </View>
        );
      })}

      {entries.length === 0 ? (
        <Text style={styles.muted}>No contact methods yet.</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          onChange([
            ...entries,
            { key: crypto.randomUUID(), draft: contactMethodDraftOf() },
          ])
        }
      >
        <Text style={styles.link}>Add contact method</Text>
      </Pressable>
    </View>
  );
}
