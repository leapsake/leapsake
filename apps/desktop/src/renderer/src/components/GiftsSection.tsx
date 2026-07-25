import type {
  GiftForRecipient,
  GiftSuggestionForRecipient,
} from "@leapsake/core";
import type { GiftIdea, GiftPartyType } from "@leapsake/schema";
import { formatGiftDate, formatGiftTargetDate } from "@leapsake/schema";
import { useRef, useState } from "react";
import { Link, useRevalidator } from "react-router-dom";
import { GiftAdornmentsEditor } from "./GiftAdornmentsEditor";
import { GiftCaptureForm } from "./GiftCaptureForm";
import { dateFieldsOf } from "./GiftOccasionFields";

/** One gift idea's standing for this recipient: its suggestion(s), if any, and
 *  its giving(s), if any — the two tables unioned by idea for a single list. */
interface IdeaGroup {
  ideaId: string;
  title: string;
  url: string | null;
  suggestions: GiftSuggestionForRecipient[];
  gifts: GiftForRecipient[];
}

/**
 * The "Gifts" section on a Person or Pet screen. One consolidated capture form on
 * top — type a gift (autocompleting existing ideas), and it's a suggestion; add a
 * date and it's a logged giving (plans/gifts.md) — over one list combining
 * **suggestions** (candidates) and **givings** (dated events), grouped by idea.
 * A giving points at the idea, never the suggestion, so "✓ given" is just a fact
 * read alongside (the suggestion row never changes state); candidates not yet
 * given lead, given ideas sink.
 */
export function GiftsSection({
  recipientType,
  recipientId,
  recipientLabel,
  suggestions,
  gifts,
  ideaPool,
}: {
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  suggestions: GiftSuggestionForRecipient[];
  gifts: GiftForRecipient[];
  ideaPool: GiftIdea[];
}) {
  const revalidator = useRevalidator();

  // Union suggestions + gifts into one entry per idea.
  const groups = new Map<string, IdeaGroup>();
  const groupFor = (ideaId: string, title: string, url: string | null) => {
    const existing = groups.get(ideaId);
    if (existing) return existing;
    const created: IdeaGroup = {
      ideaId,
      title,
      url,
      suggestions: [],
      gifts: [],
    };
    groups.set(ideaId, created);
    return created;
  };
  for (const s of suggestions) {
    groupFor(s.giftIdeaId, s.ideaTitle, s.ideaUrl).suggestions.push(s);
  }
  for (const g of gifts) {
    groupFor(g.giftIdeaId, g.ideaTitle, g.ideaUrl).gifts.push(g);
  }
  // Candidates (not yet given) lead; given ideas sink. Alphabetical within each.
  const ordered = [...groups.values()].sort((a, b) => {
    const aGiven = a.gifts.length > 0 ? 1 : 0;
    const bGiven = b.gifts.length > 0 ? 1 : 0;
    return aGiven - bGiven || a.title.localeCompare(b.title);
  });

  // Serialised removes (see HolidaysSection): a submission started mid-flight
  // supersedes the previous one, which would silently drop a rapid click.
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which row (if any) has its occasion/date editor open — one at a time, keyed
  // by row id, so the list doesn't grow a form per entry.
  const [editing, setEditing] = useState<string | null>(null);
  const recipient = { type: recipientType, id: recipientId };
  const closeEditor = () => {
    setEditing(null);
    revalidator.revalidate();
  };

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

  const joinBits = (bits: (string | null)[]) => bits.filter(Boolean).join(", ");

  return (
    <section>
      <header>
        <h2>Gifts</h2>
      </header>

      <GiftCaptureForm
        ideaPool={ideaPool}
        fixedRecipient={{
          type: recipientType,
          id: recipientId,
          label: recipientLabel,
        }}
      />

      {error !== null && <p>Couldn't save: {error}</p>}

      {ordered.length === 0 ? (
        <p>No gifts yet.</p>
      ) : (
        <ul>
          {ordered.map((group) => (
            <li key={group.ideaId}>
              <Link to={`/gifts/${group.ideaId}/edit`}>{group.title}</Link>
              {group.url !== null && (
                <>
                  {" "}
                  <a href={group.url} target="_blank" rel="noreferrer">
                    link
                  </a>
                </>
              )}
              <ul>
                {group.suggestions.map((s) => {
                  const target = formatGiftTargetDate(s);
                  const bits = joinBits([
                    s.occasionLabel,
                    target === "" ? null : target,
                  ]);
                  return (
                    <li key={s.id}>
                      Suggested{bits === "" ? "" : ` — ${bits}`}{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setEditing(editing === s.id ? null : s.id)
                        }
                      >
                        {editing === s.id ? "Close" : "Edit"}
                      </button>{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            window.api.gifts.suggestions.softDelete(s.id),
                          )
                        }
                      >
                        Remove
                      </button>
                      {editing === s.id && (
                        <GiftAdornmentsEditor
                          kind="suggestion"
                          rowId={s.id}
                          recipient={recipient}
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
                          onDone={closeEditor}
                        />
                      )}
                    </li>
                  );
                })}
                {group.gifts.map((g) => {
                  const when = formatGiftDate(g);
                  const bits = joinBits([
                    when === "" ? null : when,
                    g.giverLabel !== null ? `from ${g.giverLabel}` : null,
                    g.occasionLabel,
                  ]);
                  return (
                    <li key={g.id}>
                      ✓ Given{bits === "" ? "" : ` — ${bits}`}{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setEditing(editing === g.id ? null : g.id)
                        }
                      >
                        {editing === g.id ? "Close" : "Edit"}
                      </button>{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(() => window.api.gifts.given.softDelete(g.id))
                        }
                      >
                        Remove
                      </button>
                      {editing === g.id && (
                        <GiftAdornmentsEditor
                          kind="giving"
                          rowId={g.id}
                          recipient={recipient}
                          occasion={
                            g.occasionType !== null && g.occasionId !== null
                              ? { type: g.occasionType, id: g.occasionId }
                              : null
                          }
                          date={dateFieldsOf(g)}
                          onDone={closeEditor}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
