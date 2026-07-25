import type { GiftForRecipient, GiftOccasionOption } from "@leapsake/core";
import type {
  CaptureRecipient,
  GiftIdea,
  GiftOccasion,
  GiftPartyType,
} from "@leapsake/schema";
import { formatGiftDate } from "@leapsake/schema";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import {
  type DateFields,
  GiftOccasionFields,
  emptyDate,
  parseDateFields,
} from "./GiftOccasionFields";
import { MultiAddCombobox } from "./MultiAddCombobox";

/** A person/pet that can be a recipient — the Gifts-screen recipient picker's pool. */
export interface PartyOption {
  type: GiftPartyType;
  id: string;
  label: string;
}

/** One giving being authored: a what-happened date and an optional occasion.
 *  `id` is a stable React key across adds/removes. */
interface GivingRow {
  id: string;
  date: DateFields;
  occasion: GiftOccasion | null;
}

/** What the "For…" disclosure holds for a recipient that ends up a *suggestion*
 *  (no dates) — its target date and occasion. */
interface SuggestionFields {
  date: DateFields;
  occasion: GiftOccasion | null;
}

/** A recipient in the Gifts-screen form, with *its own* givings (a date under
 *  Alice is a gift to Alice, not to everyone) and its own suggestion fields. */
interface RecipientEntry {
  option: PartyOption;
  givings: GivingRow[];
  suggestion: SuggestionFields;
}

const newGivingRow = (): GivingRow => ({
  id: crypto.randomUUID(),
  date: emptyDate(),
  occasion: null,
});

const newSuggestionFields = (): SuggestionFields => ({
  date: emptyDate(),
  occasion: null,
});

/** The giving rows as capture givings — a row with neither a date nor an occasion
 *  is blank and drops out. */
function givingsOf(rows: GivingRow[]): {
  date?: NonNullable<ReturnType<typeof parseDateFields>>;
  occasion?: GiftOccasion | null;
}[] {
  return rows
    .map((row) => ({ date: parseDateFields(row.date), occasion: row.occasion }))
    .filter((g) => g.date !== null || g.occasion !== null)
    .map((g) => ({
      ...(g.date === null ? {} : { date: g.date }),
      occasion: g.occasion,
    }));
}

/** The repeatable "Given on…" rows — reused for the fixed recipient and for each
 *  picked recipient on the Gifts screen. Each row carries its own occasion,
 *  because givings are per-date: two Christmases are two rows. */
function GivingRows({
  rows,
  occasions,
  onChange,
}: {
  rows: GivingRow[];
  occasions: GiftOccasionOption[];
  onChange: (rows: GivingRow[]) => void;
}) {
  const update = (id: string, patch: Partial<GivingRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div>
      {rows.map((row) => (
        <div key={row.id}>
          <GiftOccasionFields
            legend="Given on… (a date makes it a logged gift, not a suggestion)"
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
              Remove date
            </button>
          </p>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, newGivingRow()])}>
        + Add a date
      </button>
    </div>
  );
}

/**
 * The suggestion arm's "For…" disclosure — collapsed by default so the common
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
  occasions: GiftOccasionOption[];
  onChange: (fields: SuggestionFields) => void;
}) {
  const set = fields.occasion !== null || parseDateFields(fields.date) !== null;
  return (
    <details open={set}>
      <summary>For… (an occasion or a target date, optional)</summary>
      <GiftOccasionFields
        legend="For…"
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
 * The re-gift guard (plans/gifts.md sequencing 3): what this recipient has
 * *already been given* of the idea being typed. A giving points at the idea, so
 * this is the same `(gift_idea_id, recipient)` read the "✓ given" annotation
 * makes — surfaced here, at the moment it can still change the user's mind,
 * rather than only in the list below.
 *
 * Phrased without a giver on purpose: what matters is that they already have one,
 * whoever gave it.
 */
function AlreadyGivenNotice({
  label,
  gifts,
}: {
  label: string;
  gifts: GiftForRecipient[];
}) {
  if (gifts.length === 0) return null;
  const when = gifts.map((g) => formatGiftDate(g)).filter((s) => s !== "");
  return (
    <p>
      ⚠ {label} was already given this
      {when.length > 0 ? ` — ${when.join(", ")}` : ""}.
    </p>
  );
}

/** What the form knows about one party: the occasions it can name, and what it
 *  has already been given (the re-gift guard's source). */
interface PartyContext {
  occasions: GiftOccasionOption[];
  given: GiftForRecipient[];
}

const EMPTY_CONTEXT: PartyContext = { occasions: [], given: [] };

/**
 * Each party's context, fetched once per party and kept for the life of the form.
 * Keyed `type:id`; an unfetched party reads as empty, so the pickers render
 * (empty) rather than flicker in.
 */
function usePartyContext(parties: PartyOption[]): Map<string, PartyContext> {
  const [pools, setPools] = useState<Map<string, PartyContext>>(new Map());
  // Which parties have been asked for, in a ref rather than in `pools`: the
  // effect must not re-run each time a fetch lands, or picking one recipient
  // would re-ask for every earlier one.
  const asked = useRef(new Set<string>());
  const wanted = parties.map((p) => `${p.type}:${p.id}`).join(",");

  useEffect(() => {
    let active = true;
    for (const key of wanted === "" ? [] : wanted.split(",")) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      const [type, ...rest] = key.split(":");
      const party = type as PartyOption["type"];
      const id = rest.join(":");
      void Promise.all([
        window.api.gifts.occasionsFor(party, id),
        window.api.gifts.given.listForRecipient(party, id),
      ]).then(([occasions, given]) => {
        if (active) {
          setPools((prev) => new Map(prev).set(key, { occasions, given }));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [wanted]);

  return pools;
}

/**
 * The one consolidated "capture a gift" form (plans/gifts.md). Type a gift's
 * name (autocompleting existing ideas) or paste a URL; that alone captures an
 * **idea**. On the Gifts screen you then add **recipients** (each a suggestion),
 * and dates are entered **per recipient** (a date under Alice is a gift to Alice);
 * on a Person/Pet screen the recipient is fixed and the dates apply to them.
 * Adding one or more dates turns that recipient into that many **givings** — the
 * giver defaults to you. One submit, one transaction (`gifts.capture`).
 *
 * `fixedRecipient` (Person/Pet screen) and `recipientCandidates` (Gifts screen)
 * are mutually exclusive: the former hides the recipient picker, the latter shows
 * a multi-add over people/pets.
 *
 * Both arms can name an **occasion** — a milestone of the recipient's or a holiday
 * they observe. A giving carries one per date row (two Christmases are two rows);
 * a suggestion carries one alongside its *target* date, behind a collapsed "For…"
 * disclosure so the common case stays two fields.
 */
export function GiftCaptureForm({
  ideaPool,
  fixedRecipient,
  recipientCandidates,
  startWithGiving = false,
  redirectTo,
}: {
  ideaPool: GiftIdea[];
  fixedRecipient?: PartyOption;
  recipientCandidates?: PartyOption[];
  /** Open with one blank date row, so the form reads as "log a giving" rather
   *  than "shortlist an idea" (the completed-gift-reminder hand-off). */
  startWithGiving?: boolean;
  /** When set (a standalone create screen), navigate here after a save; otherwise
   *  the form stays put and revalidates in place (an inline section). */
  redirectTo?: string;
}) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
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

  const chosenIds = new Set(
    recipients.map((r) => `${r.option.type}:${r.option.id}`),
  );
  const addableRecipients = (recipientCandidates ?? []).filter(
    (c) => !chosenIds.has(`${c.type}:${c.id}`),
  );

  // One context per party in play — the fixed recipient, or everyone picked.
  const pools = usePartyContext(
    fixedRecipient ? [fixedRecipient] : recipients.map((r) => r.option),
  );
  const contextFor = (party: PartyOption) =>
    pools.get(`${party.type}:${party.id}`) ?? EMPTY_CONTEXT;
  const poolFor = (party: PartyOption) => contextFor(party).occasions;

  const patchRecipient = (key: string, patch: Partial<RecipientEntry>) =>
    setRecipients((prev) =>
      prev.map((r) =>
        `${r.option.type}:${r.option.id}` === key ? { ...r, ...patch } : r,
      ),
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
  const alreadyGiven = (party: PartyOption): GiftForRecipient[] =>
    typedIdea === undefined
      ? []
      : contextFor(party).given.filter((g) => g.giftIdeaId === typedIdea.id);

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
      setError("A gift needs a name.");
      return;
    }
    const giftIdea = typedIdea
      ? { id: typedIdea.id }
      : {
          title: trimmedTitle,
          url: url.trim() !== "" ? url.trim() : undefined,
        };

    // Each recipient carries both arms; core reads the givings when there are
    // any and the suggestion fields otherwise.
    const entryFor = (
      party: PartyOption,
      givings: GivingRow[],
      suggestion: SuggestionFields,
    ): CaptureRecipient => ({
      party: { type: party.type, id: party.id },
      givings: givingsOf(givings),
      suggestion: {
        occasion: suggestion.occasion,
        targetDate: parseDateFields(suggestion.date),
      },
    });

    const captureRecipients: CaptureRecipient[] = fixedRecipient
      ? [entryFor(fixedRecipient, fixedGivings, fixedSuggestion)]
      : recipients.map((r) => entryFor(r.option, r.givings, r.suggestion));

    setBusy(true);
    setError(null);
    try {
      await window.api.gifts.capture({
        giftIdea,
        recipients: captureRecipients,
      });
      if (redirectTo !== undefined) {
        navigate(redirectTo);
      } else {
        reset();
        revalidator.revalidate();
      }
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
          <label htmlFor={`${listId}-title`}>Gift</label>
          <br />
          <input
            id={`${listId}-title`}
            list={listId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Red Ryder BB Gun"
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
            placeholder="https://… (optional)"
            aria-label="Gift link"
          />
        </p>

        {fixedRecipient ? (
          <>
            <AlreadyGivenNotice
              label={fixedRecipient.label}
              gifts={alreadyGiven(fixedRecipient)}
            />
            {fixedGivings.length === 0 && (
              <SuggestionDisclosure
                fields={fixedSuggestion}
                occasions={poolFor(fixedRecipient)}
                onChange={setFixedSuggestion}
              />
            )}
            <GivingRows
              rows={fixedGivings}
              occasions={poolFor(fixedRecipient)}
              onChange={setFixedGivings}
            />
          </>
        ) : (
          <div>
            <MultiAddCombobox
              label="Add a person or pet to gift"
              placeholder="For whom? (optional)"
              options={addableRecipients}
              getKey={(c) => `${c.type}:${c.id}`}
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
            />
            {recipients.map((r) => {
              const key = `${r.option.type}:${r.option.id}`;
              return (
                <fieldset key={key}>
                  <legend>
                    {r.option.label}{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setRecipients((prev) =>
                          prev.filter(
                            (p) => `${p.option.type}:${p.option.id}` !== key,
                          ),
                        )
                      }
                    >
                      Remove
                    </button>
                  </legend>
                  <AlreadyGivenNotice
                    label={r.option.label}
                    gifts={alreadyGiven(r.option)}
                  />
                  {r.givings.length === 0 && (
                    <SuggestionDisclosure
                      fields={r.suggestion}
                      occasions={poolFor(r.option)}
                      onChange={(suggestion) =>
                        patchRecipient(key, { suggestion })
                      }
                    />
                  )}
                  <GivingRows
                    rows={r.givings}
                    occasions={poolFor(r.option)}
                    onChange={(givings) => patchRecipient(key, { givings })}
                  />
                </fieldset>
              );
            })}
          </div>
        )}

        {error !== null && <p>Couldn't save: {error}</p>}

        <p>
          <button type="submit">{anyDates ? "Log gift" : "Add"}</button>
        </p>
      </fieldset>
    </form>
  );
}
