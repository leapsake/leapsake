import { useState } from "react";
import { useSerializedWrites } from "../../headless/useSerializedWrites.js";
import { GiftAdornmentsEditor } from "../gifts/GiftAdornmentsEditor.js";
import { dateFieldsOf } from "../gifts/GiftOccasionFields.js";
import {
  type IdeaSuggestionRow,
  type PartyOption,
  useGiftsPorts,
} from "../gifts/ports.js";
import { MultiAddCombobox } from "../primitives/MultiAddCombobox.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * The “Suggested for” section on a gift idea's edit screen — the idea end of a
 * gift suggestion. The mirror of a recipient's “Gifts” section: adding a
 * recipient here writes the same suggestion row a person page would.
 */
export function GiftIdeaRecipientsSection({
  ideaId,
  suggestions,
  candidates,
  onChanged,
}: {
  ideaId: string;
  suggestions: readonly IdeaSuggestionRow[];
  /** People and pets the idea can be suggested for — the add field's pool. */
  candidates: readonly PartyOption[];
  /** Called after each write lands, to re-read the data behind this section. */
  onChanged: () => void;
}) {
  const { createSuggestion, removeSuggestion } = useGiftsPorts();
  const { busy, error, run } = useSerializedWrites({ onSuccess: onChanged });

  // Recipients already suggested drop out of the add field.
  const already = new Set(
    suggestions.map((s) => `${s.recipientType}:${s.recipientId}`),
  );
  const addable = candidates.filter((c) => !already.has(`${c.type}:${c.id}`));

  // The suggestion whose occasion/target-date editor is open — the same edit the
  // recipient's own Gifts section offers, from the idea end.
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Section title="Suggested for">
      {error !== null && <p>Couldn't save: {error}</p>}

      <MultiAddCombobox
        label="Suggest this idea for a person or pet"
        placeholder="Suggest for someone…"
        options={addable}
        getKey={(c) => `${c.type}:${c.id}`}
        getLabel={(c) => c.label}
        onPick={(c) =>
          run(() =>
            createSuggestion({
              giftIdeaId: ideaId,
              recipientType: c.type,
              recipientId: c.id,
            }),
          )
        }
      />

      {suggestions.length === 0 ? (
        <EmptyState>Not suggested for anyone yet.</EmptyState>
      ) : (
        <ul>
          {suggestions.map((s) => (
            <li key={s.id}>
              {s.recipientLabel}
              {s.occasionLabel !== null && ` — ${s.occasionLabel}`}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(editing === s.id ? null : s.id)}
              >
                {editing === s.id ? "Close" : "Edit"}
              </button>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => removeSuggestion(s.id))}
              >
                Remove
              </button>
              {editing === s.id && (
                <GiftAdornmentsEditor
                  kind="suggestion"
                  rowId={s.id}
                  recipient={{ type: s.recipientType, id: s.recipientId }}
                  occasion={
                    s.occasionType !== null && s.occasionId !== null
                      ? { type: s.occasionType, id: s.occasionId }
                      : null
                  }
                  date={dateFieldsOf({
                    year: s.targetYear,
                    month: s.targetMonth,
                    day: s.targetDay,
                  })}
                  onDone={() => {
                    setEditing(null);
                    onChanged();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
