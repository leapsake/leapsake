import type { CaptureRecipient, GiftIdea } from "@leapsake/schema";
import { formatGiftDate } from "@leapsake/schema";
import { type FormEvent, useId, useState } from "react";
import { useMessages } from "../../messages/index.js";
import type { Messages } from "../../messages/index.js";
import { MultiAddCombobox } from "../primitives/MultiAddCombobox.js";
import {
  type GiftOccasionChoice,
  type GivenRow,
  type GivingRow,
  type PartyOption,
  type RecipientEntry,
  type SuggestionFields,
  captureRecipientOf,
  newGivingRow,
  newSuggestionFields,
  parseDateFields,
  partyKey,
  patchRecipient,
  removeRecipient,
  useGiftsPorts,
  usePartyContext,
} from "../../headless/index.js";
import { GiftOccasionFields } from "./GiftOccasionFields.js";

/** The repeatable “Given on…” rows — reused for the fixed recipient and for each
 *  picked recipient on the Gifts screen. Each row carries its own occasion,
 *  because givings are per-date: two Christmases are two rows. */
function GivingRows({
  rows,
  occasions,
  onChange,
}: {
  rows: GivingRow[];
  occasions: readonly GiftOccasionChoice[];
  onChange: (rows: GivingRow[]) => void;
}) {
  const m = useMessages();
  const update = (id: string, patch: Partial<GivingRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div>
      {rows.map((row) => (
        <div key={row.id}>
          <GiftOccasionFields
            legend={m.giftCapture.givingLegend}
            occasions={occasions}
            occasion={row.occasion}
            onOccasionChange={(occasion) => update(row.id, { occasion })}
            date={row.date}
            onDateChange={(date) => update(row.id, { date })}
          />
          <p>
            <button
              type="button"
              onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
            >
              {m.giftCapture.removeDate}
            </button>
          </p>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, newGivingRow()])}>
        {m.giftCapture.addDate}
      </button>
    </div>
  );
}

/**
 * The suggestion arm's “For…” disclosure — collapsed by default so the common
 * case (type a gift, pick a person, done) stays two fields. Only offered while
 * the recipient has no dates: with dates it's a giving, and each giving carries
 * its own occasion instead.
 */
function SuggestionDisclosure({
  fields,
  occasions,
  onChange,
}: {
  fields: SuggestionFields;
  occasions: readonly GiftOccasionChoice[];
  onChange: (fields: SuggestionFields) => void;
}) {
  const m = useMessages();
  const set = fields.occasion !== null || parseDateFields(fields.date) !== null;
  return (
    <details open={set}>
      <summary>{m.giftCapture.suggestionSummary}</summary>
      <GiftOccasionFields
        legend={m.giftCapture.suggestionLegend}
        occasions={occasions}
        occasion={fields.occasion}
        onOccasionChange={(occasion) => onChange({ ...fields, occasion })}
        date={fields.date}
        onDateChange={(date) => onChange({ ...fields, date })}
      />
    </details>
  );
}

/**
 * The re-gift guard: what this recipient has *already been given* of the idea
 * being typed. A giving points at the idea, so this is the same
 * `(gift_idea_id, recipient)` read the “✓ given” annotation makes — surfaced
 * here, at the moment it can still change the user's mind, rather than only in
 * the list below.
 *
 * Phrased without a giver on purpose: what matters is that they already have one,
 * whoever gave it.
 */
function AlreadyGivenNotice({
  label,
  gifts,
  m,
}: {
  label: string;
  gifts: readonly GivenRow[];
  m: Messages;
}) {
  if (gifts.length === 0) return null;
  const when = gifts.map((g) => formatGiftDate(g)).filter((s) => s !== "");
  return <p>{m.giftCapture.alreadyGiven(label, when)}</p>;
}

/**
 * The one consolidated “capture a gift” form. Type a gift's
 * name (autocompleting existing ideas) or paste a URL; that alone captures an
 * **idea**. On the Gifts screen you then add **recipients** (each a suggestion),
 * and dates are entered **per recipient** (a date under Alice is a gift to Alice);
 * on a Person/Pet screen the recipient is fixed and the dates apply to them.
 * Adding one or more dates turns that recipient into that many **givings** — the
 * giver defaults to you. One submit, one transaction.
 *
 * `fixedRecipient` (Person/Pet screen) and `recipientCandidates` (Gifts screen)
 * are mutually exclusive: the former hides the recipient picker, the latter shows
 * a multi-add over people/pets.
 *
 * Both arms can name an **occasion** — a milestone of the recipient's or a holiday
 * they observe. A giving carries one per date row (two Christmases are two rows);
 * a suggestion carries one alongside its *target* date, behind a collapsed “For…”
 * disclosure so the common case stays two fields.
 */
export function GiftCaptureForm({
  ideaPool,
  fixedRecipient,
  recipientCandidates,
  startWithGiving = false,
  onSaved,
}: {
  ideaPool: readonly GiftIdea[];
  fixedRecipient?: PartyOption;
  recipientCandidates?: readonly PartyOption[];
  /** Open with one blank date row, so the form reads as “log a giving” rather
   *  than “shortlist an idea” (the completed-gift-reminder hand-off). */
  startWithGiving?: boolean;
  /**
   * Called after a successful save. A standalone create screen navigates away;
   * an inline section re-reads its data in place — the form itself only knows
   * that it finished.
   */
  onSaved: () => void;
}) {
  const ports = useGiftsPorts();
  const m = useMessages();
  const listId = useId();

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  // Fixed-recipient mode: the one recipient's givings and suggestion fields.
  const [fixedGivings, setFixedGivings] = useState<GivingRow[]>(() =>
    startWithGiving ? [newGivingRow()] : [],
  );
  const [fixedSuggestion, setFixedSuggestion] =
    useState<SuggestionFields>(newSuggestionFields);
  // Gifts-screen mode: recipients each carry their own.
  const [recipients, setRecipients] = useState<RecipientEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenIds = new Set(recipients.map((r) => partyKey(r.option)));
  const addableRecipients = (recipientCandidates ?? []).filter(
    (c) => !chosenIds.has(partyKey(c)),
  );

  // One context per party in play — the fixed recipient, or everyone picked.
  const pools = usePartyContext(
    fixedRecipient ? [fixedRecipient] : recipients.map((r) => r.option),
    ports,
  );

  // An exact (case-insensitive) title match reuses the existing idea rather than
  // minting a duplicate; otherwise it's a new idea. Near-duplicate *different*
  // titles are still allowed (tolerated by design). A brand-new title can't have
  // been given before, so the re-gift guard keys off this same match.
  const trimmedTitle = title.trim();
  const typedIdea =
    trimmedTitle === ""
      ? undefined
      : ideaPool.find(
          (i) => i.title.toLowerCase() === trimmedTitle.toLowerCase(),
        );

  function reset() {
    setTitle("");
    setUrl("");
    setFixedGivings(startWithGiving ? [newGivingRow()] : []);
    setFixedSuggestion(newSuggestionFields());
    setRecipients([]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (trimmedTitle === "") {
      setError(m.giftCapture.missingTitle);
      return;
    }
    const giftIdea = typedIdea
      ? { id: typedIdea.id }
      : {
          title: trimmedTitle,
          url: url.trim() !== "" ? url.trim() : undefined,
        };

    const captureRecipients: CaptureRecipient[] = fixedRecipient
      ? [captureRecipientOf(fixedRecipient, fixedGivings, fixedSuggestion)]
      : recipients.map((r) =>
          captureRecipientOf(r.option, r.givings, r.suggestion),
        );

    setBusy(true);
    setError(null);
    try {
      await ports.capture({ giftIdea, recipients: captureRecipients });
      reset();
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const anyDates = fixedRecipient
    ? fixedGivings.length > 0
    : recipients.some((r) => r.givings.length > 0);

  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <p>
          <label htmlFor={`${listId}-title`}>{m.giftCapture.giftLabel}</label>
          <br />
          <input
            id={`${listId}-title`}
            list={listId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={m.giftCapture.titlePlaceholder}
          />
          <datalist id={listId}>
            {ideaPool.map((i) => (
              <option key={i.id} value={i.title} />
            ))}
          </datalist>{" "}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            placeholder={m.giftCapture.urlPlaceholder}
            aria-label={m.giftCapture.urlLabel}
          />
        </p>

        {fixedRecipient ? (
          <>
            <AlreadyGivenNotice
              label={fixedRecipient.label}
              gifts={pools.alreadyGiven(fixedRecipient, typedIdea?.id)}
              m={m}
            />
            {fixedGivings.length === 0 && (
              <SuggestionDisclosure
                fields={fixedSuggestion}
                occasions={pools.occasionsFor(fixedRecipient)}
                onChange={setFixedSuggestion}
              />
            )}
            <GivingRows
              rows={fixedGivings}
              occasions={pools.occasionsFor(fixedRecipient)}
              onChange={setFixedGivings}
            />
          </>
        ) : (
          <div>
            <MultiAddCombobox
              label={m.giftCapture.addRecipientLabel}
              placeholder={m.giftCapture.addRecipientPlaceholder}
              options={addableRecipients}
              getKey={partyKey}
              getLabel={(c) => c.label}
              onPick={(c) =>
                setRecipients((prev) => [
                  ...prev,
                  {
                    option: c,
                    givings: [],
                    suggestion: newSuggestionFields(),
                  },
                ])
              }
              announceAdded={m.combobox.added}
              announceCount={m.combobox.suggestionCount}
            />
            {recipients.map((r) => {
              const key = partyKey(r.option);
              return (
                <fieldset key={key}>
                  <legend>
                    {r.option.label}{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setRecipients((prev) => removeRecipient(prev, key))
                      }
                    >
                      {m.giftCapture.removeRecipient}
                    </button>
                  </legend>
                  <AlreadyGivenNotice
                    label={r.option.label}
                    gifts={pools.alreadyGiven(r.option, typedIdea?.id)}
                    m={m}
                  />
                  {r.givings.length === 0 && (
                    <SuggestionDisclosure
                      fields={r.suggestion}
                      occasions={pools.occasionsFor(r.option)}
                      onChange={(suggestion) =>
                        setRecipients((prev) =>
                          patchRecipient(prev, key, { suggestion }),
                        )
                      }
                    />
                  )}
                  <GivingRows
                    rows={r.givings}
                    occasions={pools.occasionsFor(r.option)}
                    onChange={(givings) =>
                      setRecipients((prev) =>
                        patchRecipient(prev, key, { givings }),
                      )
                    }
                  />
                </fieldset>
              );
            })}
          </div>
        )}

        {error !== null && <p>{m.common.saveFailed(error)}</p>}

        <p>
          <button type="submit">
            {anyDates
              ? m.giftCapture.submitGiving
              : m.giftCapture.submitSuggestion}
          </button>
        </p>
      </fieldset>
    </form>
  );
}
