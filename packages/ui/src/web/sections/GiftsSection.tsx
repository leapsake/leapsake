import type { GiftIdea, GiftPartyType } from "@leapsake/schema";
import { isGiven, sortGiftsGivenLast } from "@leapsake/view-models";
import { type GiftRecipientRow, useGiftsPorts } from "../../headless/index.js";
import { useSerializedWrites } from "../../headless/useSerializedWrites.js";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { GiftCaptureForm } from "../gifts/GiftCaptureForm.js";
import { EmptyState, Section } from "../primitives/Section.js";

/** A person's or pet's gifts: a capture form over the list, whose tick is a
 *  row's only state. */
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
                  aria-disabled={busy}
                  onChange={(e) => {
                    if (busy) return;
                    // Read now: by the deferred write, React has reset the
                    // controlled input to the old value.
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
                aria-disabled={busy}
                onClick={() => {
                  if (!busy) run(() => detachRecipient(row.id));
                }}
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
