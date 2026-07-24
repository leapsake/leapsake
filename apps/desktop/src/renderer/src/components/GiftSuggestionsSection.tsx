import type { GiftSuggestionForRecipient } from "@leapsake/core";
import type { GiftIdea, GiftPartyType } from "@leapsake/schema";
import { formatGiftTargetDate } from "@leapsake/schema";
import { useRef, useState } from "react";
import { Link, useRevalidator } from "react-router-dom";
import { MultiAddCombobox } from "./MultiAddCombobox";

/**
 * The "Gift ideas" section on a Person or Pet screen — the recipient end of a
 * gift suggestion (idea × recipient). The mirror of the idea's "Suggested for"
 * field: adding from either direction writes the same suggestion row, so which
 * surface a user reaches for is just what they happen to be looking at (the
 * Holidays precedent).
 *
 * The combobox suggests from the ideas not yet suggested for this recipient; the
 * "add a new idea" link mints an idea *and* this suggestion in one action.
 */
export function GiftSuggestionsSection({
  recipientType,
  recipientId,
  recipientLabel,
  suggestions,
  ideaPool,
}: {
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  suggestions: GiftSuggestionForRecipient[];
  ideaPool: GiftIdea[];
}) {
  const revalidator = useRevalidator();

  // Ideas already suggested for this recipient drop out of the add field.
  const suggested = new Set(suggestions.map((s) => s.giftIdeaId));
  const addable = ideaPool.filter((idea) => !suggested.has(idea.id));

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

      {suggestions.length === 0 ? (
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
          <tbody>
            {suggestions.map((s) => {
              const target = formatGiftTargetDate(s);
              return (
                <tr key={s.id}>
                  <td>
                    <Link to={`/gifts/${s.giftIdeaId}/edit`}>
                      {s.ideaTitle}
                    </Link>
                    {s.ideaUrl !== null && (
                      <>
                        {" "}
                        <a href={s.ideaUrl} target="_blank" rel="noreferrer">
                          link
                        </a>
                      </>
                    )}
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
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
