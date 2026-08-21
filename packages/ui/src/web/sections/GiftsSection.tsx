import type { GiftIdea, GiftPartyType } from "@leapsake/schema";
import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import { type GiftRecipientRow, useGiftsPorts } from "../../headless/index.js";
import { useSerializedWrites } from "../../headless/useSerializedWrites.js";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { GiftCaptureForm } from "../gifts/GiftCaptureForm.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * The "Gifts" section on a Person or Pet screen. One consolidated capture form on
 * top — name a gift, tick it if they already have it — over the list of what they
 * are down for. Outstanding ideas lead and given ones sink, so the section reads
 * as a shopping list for this person.
 *
 * The tick is the whole state a row has, so it is the row's own control rather
 * than something behind an Edit: there is nothing else to edit.
 */
export function GiftsSection({
  recipientType,
  recipientId,
  recipientLabel,
  gifts,
  ideaPool,
  onChanged,
}: {
  recipientType: GiftPartyType;
  recipientId: string;
  recipientLabel: string;
  gifts: readonly GiftRecipientRow[];
  ideaPool: readonly GiftIdea[];
  /** Called after each write lands, to re-read the data behind this section. */
  onChanged: () => void;
}) {
  const { Link } = useUi();
  const { setGiven, detachRecipient } = useGiftsPorts();
  const m = useMessages();
  const { busy, error, run } = useSerializedWrites({ onSuccess: onChanged });

  const ordered = sortGiftsGivenLast(gifts, (row) => row.ideaTitle);

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
          {ordered.map((row) => (
            <li key={row.id}>
              <label>
                <input
                  type="checkbox"
                  checked={isGiven(row)}
                  disabled={busy}
                  onChange={(e) => {
                    // Read the box *now*: `run` defers the write, and by the
                    // time it fires React has restored this controlled input to
                    // the value the props still say, so a deferred read would
                    // send back the state the user just changed away from.
                    const next = e.target.checked;
                    run(() => setGiven(row.id, next));
                  }}
                />{" "}
                {m.gifts.given}
              </label>{" "}
              <Link href={`/gifts/${row.giftIdeaId}/edit`}>
                {row.ideaTitle}
              </Link>
              {row.ideaUrl !== null && (
                <>
                  {" "}
                  <a href={row.ideaUrl} target="_blank" rel="noreferrer">
                    {m.gifts.link}
                  </a>
                </>
              )}{" "}
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
