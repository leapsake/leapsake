import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import {
  type IdeaRecipientRow,
  type PartyOption,
  partyKey,
  useGiftsPorts,
} from "../../headless/index.js";
import { useSerializedWrites } from "../../headless/useSerializedWrites.js";
import { useMessages } from "../../messages/index.js";
import { MultiAddCombobox } from "../primitives/MultiAddCombobox.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * The "For…" section on a gift idea's edit screen — the idea end of the same link
 * a person's Gifts section shows from the other side. Adding someone here writes
 * the row their page would; ticking the box here is the tick they would see.
 */
export function GiftIdeaRecipientsSection({
  ideaId,
  recipients,
  candidates,
  onChanged,
}: {
  ideaId: string;
  recipients: readonly IdeaRecipientRow[];
  /** People and pets the idea can be for — the add field's pool. */
  candidates: readonly PartyOption[];
  /** Called after each write lands, to re-read the data behind this section. */
  onChanged: () => void;
}) {
  const { attachRecipient, setGiven, detachRecipient } = useGiftsPorts();
  const m = useMessages();
  const { busy, error, run } = useSerializedWrites({ onSuccess: onChanged });

  // Parties already on this idea drop out of the add field — which is also why
  // there is no re-gift warning any more: they are simply already in the list.
  const already = new Set(
    recipients.map((r) =>
      partyKey({ type: r.recipientType, id: r.recipientId }),
    ),
  );
  const addable = candidates.filter((c) => !already.has(partyKey(c)));

  const ordered = sortGiftsGivenLast(recipients, (row) => row.recipientLabel);

  return (
    <Section title={m.giftIdeaRecipients.title}>
      {error !== null && <p>{m.common.saveFailed(error)}</p>}

      <MultiAddCombobox
        label={m.giftIdeaRecipients.addLabel}
        placeholder={m.giftIdeaRecipients.addPlaceholder}
        options={addable}
        getKey={partyKey}
        getLabel={(c) => c.label}
        onPick={(c) =>
          run(() =>
            attachRecipient({
              giftIdeaId: ideaId,
              party: { type: c.type, id: c.id },
            }),
          )
        }
        announceAdded={m.combobox.added}
        announceCount={m.combobox.suggestionCount}
      />

      {ordered.length === 0 ? (
        <EmptyState>{m.giftIdeaRecipients.empty}</EmptyState>
      ) : (
        <ul>
          {ordered.map((row) => (
            <li key={row.id}>
              <label>
                <input
                  type="checkbox"
                  checked={isGiven(row)}
                  disabled={busy}
                  onChange={(e) => {
                    // Read the box *now* — see the note in `GiftsSection`.
                    const next = e.target.checked;
                    run(() => setGiven(row.id, next));
                  }}
                />{" "}
                {m.giftIdeaRecipients.givenTo(row.recipientLabel)}
              </label>{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => detachRecipient(row.id))}
              >
                {m.common.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
