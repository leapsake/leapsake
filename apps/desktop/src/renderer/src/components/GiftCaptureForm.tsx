import type {
  CaptureRecipient,
  GiftIdea,
  GiftPartyType,
} from "@leapsake/schema";
import { type FormEvent, useId, useState } from "react";
import { useRevalidator } from "react-router-dom";
import { MultiAddCombobox } from "./MultiAddCombobox";

/** A person/pet that can be a recipient — the Gifts-screen recipient picker's pool. */
export interface PartyOption {
  type: GiftPartyType;
  id: string;
  label: string;
}

/** A date row in the form (strings so empty inputs stay empty, not 0/NaN); `id`
 *  is a stable React key across adds/removes. */
interface DateRow {
  id: string;
  year: string;
  month: string;
  day: string;
}

/** A recipient in the Gifts-screen form, with *its own* dates (givings are
 *  per-recipient — a date under Alice is a gift to Alice, not to everyone). */
interface RecipientEntry {
  option: PartyOption;
  dates: DateRow[];
}

const newDateRow = (): DateRow => ({
  id: crypto.randomUUID(),
  year: "",
  month: "",
  day: "",
});

/** Parse a date row into a partial date, or null when wholly blank. A lone day
 *  (no month) drops the day (the day⇒month rule). */
function parseDateRow(
  row: DateRow,
): { year: number | null; month: number | null; day: number | null } | null {
  const num = (s: string) => {
    const n = Number(s.trim());
    return s.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
  };
  const year = num(row.year);
  const month = num(row.month);
  const day = month !== null ? num(row.day) : null;
  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

/** The non-blank date rows as capture givings. */
function givingsOf(
  rows: DateRow[],
): { date: NonNullable<ReturnType<typeof parseDateRow>> }[] {
  return rows
    .map(parseDateRow)
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((date) => ({ date }));
}

/** The repeatable "Given on…" date rows — reused for the fixed recipient and for
 *  each picked recipient on the Gifts screen. */
function DateRows({
  rows,
  onChange,
}: {
  rows: DateRow[];
  onChange: (rows: DateRow[]) => void;
}) {
  const update = (id: string, patch: Partial<DateRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <fieldset>
      <legend>
        Given on…{" "}
        <small>(a date makes it a logged gift, not a suggestion)</small>
      </legend>
      {rows.map((row) => (
        <p key={row.id}>
          <input
            type="number"
            min="1"
            placeholder="Year"
            value={row.year}
            aria-label="Year"
            onChange={(e) => update(row.id, { year: e.target.value })}
          />{" "}
          <input
            type="number"
            min="1"
            max="12"
            placeholder="Month"
            value={row.month}
            aria-label="Month"
            onChange={(e) => update(row.id, { month: e.target.value })}
          />{" "}
          <input
            type="number"
            min="1"
            max="31"
            placeholder="Day"
            value={row.day}
            aria-label="Day"
            onChange={(e) => update(row.id, { day: e.target.value })}
          />{" "}
          <button
            type="button"
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            Remove date
          </button>
        </p>
      ))}
      <button type="button" onClick={() => onChange([...rows, newDateRow()])}>
        + Add a date
      </button>
    </fieldset>
  );
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
 */
export function GiftCaptureForm({
  ideaPool,
  fixedRecipient,
  recipientCandidates,
}: {
  ideaPool: GiftIdea[];
  fixedRecipient?: PartyOption;
  recipientCandidates?: PartyOption[];
}) {
  const revalidator = useRevalidator();
  const listId = useId();

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  // Fixed-recipient mode: the one recipient's dates live here.
  const [fixedDates, setFixedDates] = useState<DateRow[]>([]);
  // Gifts-screen mode: recipients each carry their own dates.
  const [recipients, setRecipients] = useState<RecipientEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenIds = new Set(
    recipients.map((r) => `${r.option.type}:${r.option.id}`),
  );
  const addableRecipients = (recipientCandidates ?? []).filter(
    (c) => !chosenIds.has(`${c.type}:${c.id}`),
  );

  const setRecipientDates = (key: string, dates: DateRow[]) =>
    setRecipients((prev) =>
      prev.map((r) =>
        `${r.option.type}:${r.option.id}` === key ? { ...r, dates } : r,
      ),
    );

  function reset() {
    setTitle("");
    setUrl("");
    setFixedDates([]);
    setRecipients([]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") {
      setError("A gift needs a name.");
      return;
    }
    // An exact (case-insensitive) title match reuses the existing idea rather than
    // minting a duplicate; otherwise it's a new idea. Near-duplicate *different*
    // titles are still allowed (tolerated by design).
    const match = ideaPool.find(
      (i) => i.title.toLowerCase() === trimmed.toLowerCase(),
    );
    const giftIdea = match
      ? { id: match.id }
      : { title: trimmed, url: url.trim() !== "" ? url.trim() : undefined };

    const captureRecipients: CaptureRecipient[] = fixedRecipient
      ? [
          {
            party: { type: fixedRecipient.type, id: fixedRecipient.id },
            givings: givingsOf(fixedDates),
          },
        ]
      : recipients.map((r) => ({
          party: { type: r.option.type, id: r.option.id },
          givings: givingsOf(r.dates),
        }));

    setBusy(true);
    setError(null);
    try {
      await window.api.gifts.capture({
        giftIdea,
        recipients: captureRecipients,
      });
      reset();
      revalidator.revalidate();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const anyDates = fixedRecipient
    ? fixedDates.length > 0
    : recipients.some((r) => r.dates.length > 0);

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
          <DateRows rows={fixedDates} onChange={setFixedDates} />
        ) : (
          <div>
            <MultiAddCombobox
              label="Add a person or pet to gift"
              placeholder="For whom? (optional)"
              options={addableRecipients}
              getKey={(c) => `${c.type}:${c.id}`}
              getLabel={(c) => c.label}
              onPick={(c) =>
                setRecipients((prev) => [...prev, { option: c, dates: [] }])
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
                  <DateRows
                    rows={r.dates}
                    onChange={(dates) => setRecipientDates(key, dates)}
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
