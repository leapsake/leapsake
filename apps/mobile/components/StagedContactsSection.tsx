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
import { DraftRow } from "./DraftRow";
import { RecordSection } from "./RecordSection";

/** What each row calls itself, mirroring {@link ContactsSection}'s glyphs. */
const KIND_GLYPH: Record<ContactMethodKind, string> = {
  email: "✉️",
  phone: "📞",
  postal: "🏠",
  social: "💬",
};
const KIND_NAME: Record<ContactMethodKind, string> = {
  email: "Email",
  phone: "Phone",
  postal: "Postal address",
  social: "Social",
};

/** A row's name; a social row names its platform once it has one. */
function nameFor(draft: ContactMethodDraft): string {
  if (draft.kind !== "social") return KIND_NAME[draft.kind];
  const named = findPlatform(draft.platform)?.name ?? draft.platform.trim();
  return named === "" ? KIND_NAME.social : named;
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
    <RecordSection
      title="Contact"
      link={{
        what: "contact method",
        action: "add",
        onPress: () =>
          onChange([
            ...entries,
            { key: crypto.randomUUID(), draft: contactMethodDraftOf() },
          ]),
      }}
      isEmpty={entries.length === 0}
      emptyText="No contact methods yet."
    >
      {entries.map((entry) => {
        const setDraft = (draft: ContactMethodDraft) =>
          onChange(
            entries.map((e) => (e.key === entry.key ? { ...e, draft } : e)),
          );
        return (
          <DraftRow
            key={entry.key}
            label={
              <>
                {KIND_GLYPH[entry.draft.kind]} {nameFor(entry.draft)}
              </>
            }
            subject={nameFor(entry.draft)}
            onRemove={() =>
              onChange(entries.filter((e) => e.key !== entry.key))
            }
          >
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
          </DraftRow>
        );
      })}
    </RecordSection>
  );
}
