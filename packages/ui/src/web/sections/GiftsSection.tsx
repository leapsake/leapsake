import type { GiftIdea, GiftPartyType } from "@leapsake/schema";
import { formatGiftDate, formatGiftTargetDate } from "@leapsake/schema";
import { groupGiftsByIdea } from "@leapsake/view-models";
import { useState } from "react";
import { dateFieldsOf } from "../../headless/index.js";
import { useSerializedWrites } from "../../headless/useSerializedWrites.js";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { GiftAdornmentsEditor } from "../gifts/GiftAdornmentsEditor.js";
import { GiftCaptureForm } from "../gifts/GiftCaptureForm.js";
import {
  type GivenRow,
  type SuggestionRow,
  useGiftsPorts,
} from "../gifts/ports.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * The “Gifts” section on a Person or Pet screen. One consolidated capture form on
 * top — type a gift (autocompleting existing ideas), and it's a suggestion; add a
 * date and it's a logged giving — over one list combining
 * **suggestions** (candidates) and **givings** (dated events), grouped by idea.
 * A giving points at the idea, never the suggestion, so “✓ given” is just a fact
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
  onChanged,
}: {
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  suggestions: readonly SuggestionRow[];
  gifts: readonly GivenRow[];
  ideaPool: readonly GiftIdea[];
  /** Called after each write lands, to re-read the data behind this section. */
  onChanged: () => void;
}) {
  const { Link } = useUi();
  const { removeSuggestion, removeGiving } = useGiftsPorts();
  const m = useMessages();
  const { busy, error, run } = useSerializedWrites({ onSuccess: onChanged });

  // Suggestions + givings unioned into one entry per idea, candidates leading.
  const ordered = groupGiftsByIdea<SuggestionRow, GivenRow>(suggestions, gifts);

  // Which row (if any) has its occasion/date editor open — one at a time, keyed
  // by row id, so the list doesn't grow a form per entry.
  const [editing, setEditing] = useState<string | null>(null);
  const recipient = { type: recipientType, id: recipientId };
  const closeEditor = () => {
    setEditing(null);
    onChanged();
  };

  return (
    <Section title={m.gifts.title}>
      <GiftCaptureForm
        ideaPool={ideaPool}
        fixedRecipient={{
          type: recipientType,
          id: recipientId,
          label: recipientLabel,
        }}
        onSaved={onChanged}
      />

      {error !== null && <p>{m.common.saveFailed(error)}</p>}

      {ordered.length === 0 ? (
        <EmptyState>{m.gifts.empty}</EmptyState>
      ) : (
        <ul>
          {ordered.map((group) => (
            <li key={group.ideaId}>
              <Link href={`/gifts/${group.ideaId}/edit`}>{group.title}</Link>
              {group.url !== null && (
                <>
                  {" "}
                  <a href={group.url} target="_blank" rel="noreferrer">
                    {m.gifts.link}
                  </a>
                </>
              )}
              <ul>
                {group.suggestions.map((s) => {
                  const target = formatGiftTargetDate(s);
                  const details = [
                    s.occasionLabel,
                    target === "" ? null : target,
                  ].filter((bit) => bit !== null);
                  return (
                    <li key={s.id}>
                      {m.gifts.suggested(details)}{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setEditing(editing === s.id ? null : s.id)
                        }
                      >
                        {editing === s.id ? m.common.close : m.common.edit}
                      </button>{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => removeSuggestion(s.id))}
                      >
                        {m.common.remove}
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
                  const details = [
                    when === "" ? null : when,
                    g.giverLabel === null
                      ? null
                      : m.gifts.fromGiver(g.giverLabel),
                    g.occasionLabel,
                  ].filter((bit) => bit !== null);
                  return (
                    <li key={g.id}>
                      {m.gifts.given(details)}{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setEditing(editing === g.id ? null : g.id)
                        }
                      >
                        {editing === g.id ? m.common.close : m.common.edit}
                      </button>{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => removeGiving(g.id))}
                      >
                        {m.common.remove}
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
    </Section>
  );
}
