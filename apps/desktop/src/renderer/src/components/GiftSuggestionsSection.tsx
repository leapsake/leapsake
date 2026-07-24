import type {
  GiftForRecipient,
  GiftSuggestionForRecipient,
} from "@leapsake/core";
import type { GiftIdea, GiftPartyType } from "@leapsake/schema";
import { formatGiftDate, formatGiftTargetDate } from "@leapsake/schema";
import { useRef, useState } from "react";
import { Link, useRevalidator } from "react-router-dom";
import { MultiAddCombobox } from "./MultiAddCombobox";

/**
 * The "Gift ideas" section on a Person or Pet screen — the recipient end of a
 * gift suggestion (idea × recipient). The mirror of the idea's "Suggested for"
 * field: adding from either direction writes the same suggestion row (the
 * Holidays precedent).
 *
 * Gifts already **given** to this recipient (a query over `(gift_idea_id,
 * recipient)`, no state column) drive three things non-destructively: the add
 * field annotates an already-given idea (the **re-gift guard**), a given
 * suggestion shows "✓ given" and drops out of the default shortlist into an
 * "Already given" disclosure — the suggestion row itself never changes state.
 */
export function GiftSuggestionsSection({
  recipientType,
  recipientId,
  recipientLabel,
  suggestions,
  ideaPool,
  giftsGiven,
}: {
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  suggestions: GiftSuggestionForRecipient[];
  ideaPool: GiftIdea[];
  giftsGiven: GiftForRecipient[];
}) {
  const revalidator = useRevalidator();

  // idea id → the (most recent) giving's rendered date, "" when dated-unknown.
  // `giftsGiven` is newest-first, so the first entry per idea wins.
  const givenByIdea = new Map<string, string>();
  for (const g of giftsGiven) {
    if (!givenByIdea.has(g.giftIdeaId)) {
      givenByIdea.set(g.giftIdeaId, formatGiftDate(g));
    }
  }
  const givenLabel = (date: string) =>
    date === "" ? "given" : `given ${date}`;

  // Ideas already suggested for this recipient drop out of the add field.
  const suggested = new Set(suggestions.map((s) => s.giftIdeaId));
  const addable = ideaPool.filter((idea) => !suggested.has(idea.id));

  // Split suggestions: not-yet-given lead; given ones sink into a disclosure.
  const open = suggestions.filter((s) => !givenByIdea.has(s.giftIdeaId));
  const given = suggestions.filter((s) => givenByIdea.has(s.giftIdeaId));

  // Serialised writes (see HolidaysSection): a submission started mid-flight
  // supersedes the previous one, which would silently drop a rapid pick.
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

  const suggestionRow = (s: GiftSuggestionForRecipient) => {
    const target = formatGiftTargetDate(s);
    const givenDate = givenByIdea.get(s.giftIdeaId);
    return (
      <tr key={s.id}>
        <td>
          <Link to={`/gifts/${s.giftIdeaId}/edit`}>{s.ideaTitle}</Link>
          {s.ideaUrl !== null && (
            <>
              {" "}
              <a href={s.ideaUrl} target="_blank" rel="noreferrer">
                link
              </a>
            </>
          )}
          {givenDate !== undefined && <> — ✓ {givenLabel(givenDate)}</>}
        </td>
        <td>{s.occasionLabel ?? "—"}</td>
        <td>{target === "" ? "—" : target}</td>
        <td>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() => window.api.gifts.suggestions.softDelete(s.id))
            }
          >
            Remove
          </button>
        </td>
      </tr>
    );
  };

  return (
    <section>
      <header>
        <h2>Gift ideas</h2>
      </header>

      {error !== null && <p>Couldn't save: {error}</p>}

      <MultiAddCombobox
        label={`Suggest a gift idea for ${recipientLabel}`}
        placeholder="Suggest an existing idea…"
        options={addable}
        getKey={(i) => i.id}
        getLabel={(i) => i.title}
        // Re-gift guard: an idea already given to this recipient is annotated in
        // the picker, so "you gave them this" surfaces before you suggest it again.
        renderOption={(i) => {
          const d = givenByIdea.get(i.id);
          return d === undefined ? i.title : `${i.title} (✓ ${givenLabel(d)})`;
        }}
        onPick={(idea) =>
          run(() =>
            window.api.gifts.suggestions.create({
              giftIdeaId: idea.id,
              recipientType,
              recipientId,
            }),
          )
        }
      />

      <p>
        <Link
          to={`/gifts/new?for=${recipientType}:${recipientId}`}
        >{`Add a new gift idea for ${recipientLabel}`}</Link>
      </p>

      {open.length === 0 ? (
        <p>No gift ideas yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Idea</th>
              <th>Occasion</th>
              <th>Target</th>
              <th />
            </tr>
          </thead>
          <tbody>{open.map(suggestionRow)}</tbody>
        </table>
      )}

      {given.length > 0 && (
        <details>
          <summary>Already given ({given.length})</summary>
          <table>
            <tbody>{given.map(suggestionRow)}</tbody>
          </table>
        </details>
      )}
    </section>
  );
}
