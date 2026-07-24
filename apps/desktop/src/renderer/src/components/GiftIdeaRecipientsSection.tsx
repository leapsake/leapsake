import type { GiftSuggestionForIdea } from "@leapsake/core";
import type { GiftPartyType } from "@leapsake/schema";
import { useRef, useState } from "react";
import { useRevalidator } from "react-router-dom";
import { MultiAddCombobox } from "./MultiAddCombobox";

/** A person/pet the idea can be suggested for — the add field's pool. */
export interface RecipientCandidate {
  type: GiftPartyType;
  id: string;
  label: string;
}

/**
 * The "Suggested for" section on a gift idea's edit screen — the idea end of a
 * gift suggestion. The mirror of a recipient's "Gift ideas" field: adding a
 * recipient here writes the same suggestion row a person page would.
 */
export function GiftIdeaRecipientsSection({
  ideaId,
  suggestions,
  candidates,
}: {
  ideaId: string;
  suggestions: GiftSuggestionForIdea[];
  candidates: RecipientCandidate[];
}) {
  const revalidator = useRevalidator();

  // Recipients already suggested drop out of the add field.
  const already = new Set(
    suggestions.map((s) => `${s.recipientType}:${s.recipientId}`),
  );
  const addable = candidates.filter((c) => !already.has(`${c.type}:${c.id}`));

  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(op: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    inFlight.current = inFlight.current
      .then(() => op())
      .then(
        () => revalidator.revalidate(),
        (e: unknown) => setError(String(e)),
      )
      .finally(() => setBusy(false));
  }

  return (
    <section>
      <header>
        <h2>Suggested for</h2>
      </header>

      {error !== null && <p>Couldn't save: {error}</p>}

      <MultiAddCombobox
        label="Suggest this idea for a person or pet"
        placeholder="Suggest for someone…"
        options={addable}
        getKey={(c) => `${c.type}:${c.id}`}
        getLabel={(c) => c.label}
        onPick={(c) =>
          run(() =>
            window.api.gifts.suggestions.create({
              giftIdeaId: ideaId,
              recipientType: c.type,
              recipientId: c.id,
            }),
          )
        }
      />

      {suggestions.length === 0 ? (
        <p>Not suggested for anyone yet.</p>
      ) : (
        <ul>
          {suggestions.map((s) => (
            <li key={s.id}>
              {s.recipientLabel}
              {s.occasionLabel !== null && ` — ${s.occasionLabel}`}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() => window.api.gifts.suggestions.softDelete(s.id))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
