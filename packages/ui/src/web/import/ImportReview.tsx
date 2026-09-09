import type { ParsedBirthday, ParsedContact } from "@leapsake/vcard";
import { useEffect, useMemo, useState } from "react";
import { useMessages } from "../../messages/index.js";
import type { Messages } from "../../messages/index.js";
import styles from "./ImportOverlay.module.css";

/**
 * A person already in Leapsake that an incoming contact looks like.
 *
 * Declared structurally rather than imported from `@leapsake/core`, keeping the
 * package off the data layer — core's `DuplicateMatch` stays assignable.
 */
export interface ImportDuplicateMatch {
  tier: string;
  name: string;
  reasons: string[];
}

/**
 * An entity the incoming card **is**, rather than one it resembles — its `UID`
 * names something already stored. Structural for the same reason as
 * {@link ImportDuplicateMatch}: core's `AlreadyStored` stays assignable without
 * this package reaching for the data layer.
 */
export interface ImportAlreadyStored {
  type: "person" | "pet";
  id: string;
  name: string;
}

/** One incoming contact's likely duplicates, by its position in the file. */
export interface ImportPreviewEntry {
  index: number;
  matches: ImportDuplicateMatch[];
  /** Set when this card's `UID` names an entity already stored — a certainty,
   *  unlike `matches`, which are resemblances. `null` for a foreign card. */
  alreadyStored?: ImportAlreadyStored | null;
}

/** What the user decided about one incoming contact. */
export interface ImportDecision {
  action: "create" | "skip";
  contact: ParsedContact;
}

/** What a commit did, plus whether the app wants to offer the self prompt. */
export interface ImportOutcome {
  created: number;
  skipped: number;
  errors: { index: number; contact: ParsedContact; message: string }[];
  /**
   * Whether to offer “which of these is you?” — the app's call, since it is the
   * side that knows whether a self-person is already set.
   */
  offerPickSelf: boolean;
}

interface Row {
  contact: ParsedContact;
  action: "create" | "skip";
  /**
   * Whether the user has agreed that this card is *them* — deliberately not the
   * same thing as `contact.isSelf`, which is only what the **card claims**.
   *
   * Starting at `false` for every card, whatever it says, is what makes the
   * claim safe to honour at all: opting in is an explicit act, so dropping
   * somebody else's export in can never silently take over the `self_person`
   * pointer. It also means this component needs no idea whether a self is
   * already set — the answer is the same either way.
   */
  setSelf: boolean;
}

/**
 * The review step: after a dropped contact file is parsed, show what will be
 * imported — per contact its name (editable, so a mononym / organisation card
 * with no last name can be fixed before commit), its contact methods and
 * birthday, anything that won't be imported, and a flag when it looks like
 * someone already in Leapsake — then commit only on the user's confirm.
 *
 * Every read and write is injected. What happens *after* a commit — revalidating,
 * routing to the duplicate review or the list — is the app's decision, reached
 * through `onDone` and `onPickSelf`.
 */
export function ImportReview({
  contacts,
  onPreview,
  onCommit,
  onClose,
  onDone,
  onPickSelf,
}: {
  contacts: readonly ParsedContact[];
  /** Likely-duplicate flags for the incoming contacts. */
  onPreview: (
    contacts: readonly ParsedContact[],
  ) => Promise<ImportPreviewEntry[]>;
  onCommit: (decisions: ImportDecision[]) => Promise<ImportOutcome>;
  onClose: () => void;
  /** The user is finished with the result summary. */
  onDone: (outcome: ImportOutcome) => void;
  onPickSelf: () => void;
}) {
  const m = useMessages();

  const [rows, setRows] = useState<Row[]>(() =>
    contacts.map((contact) => ({ contact, action: "create", setSelf: false })),
  );
  const [matchesByIndex, setMatchesByIndex] = useState<
    Map<number, ImportDuplicateMatch[]>
  >(new Map());
  const [storedByIndex, setStoredByIndex] = useState<
    Map<number, ImportAlreadyStored>
  >(new Map());
  const [phase, setPhase] = useState<"review" | "committing" | "done">(
    "review",
  );
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  // Fetch likely-duplicate flags once; a failure just leaves rows unflagged.
  useEffect(() => {
    let live = true;
    void onPreview(contacts).then((preview) => {
      if (!live) return;
      setMatchesByIndex(new Map(preview.map((p) => [p.index, p.matches])));
      setStoredByIndex(
        new Map(
          preview.flatMap((p) =>
            p.alreadyStored ? [[p.index, p.alreadyStored] as const] : [],
          ),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [contacts, onPreview]);

  const chosen = useMemo(
    () => rows.filter((r) => r.action === "create").length,
    [rows],
  );

  function setName(
    index: number,
    field: "firstName" | "lastName",
    value: string,
  ) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              contact: {
                ...row.contact,
                name: { ...row.contact.name, [field]: value },
              },
            }
          : row,
      ),
    );
  }

  function toggleSkip(index: number) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? { ...row, action: row.action === "skip" ? "create" : "skip" }
          : row,
      ),
    );
  }

  /** The user answering the card's "this is you" claim. Only one card can be the
   *  self, so agreeing to one withdraws it from every other. */
  function toggleSelf(index: number) {
    setRows((prev) =>
      prev.map((row, i) => ({ ...row, setSelf: i === index && !row.setSelf })),
    );
  }

  async function confirm() {
    setPhase("committing");
    const committed = await onCommit(
      // The card's claim is replaced by the user's answer on the way out, so
      // what the importer acts on is only ever what was agreed to here.
      rows.map((row) => ({
        action: row.action,
        contact: { ...row.contact, isSelf: row.setSelf },
      })),
    );
    setOutcome(committed);
    setPhase("done");
  }

  if (phase === "done" && outcome) {
    return (
      <div className={styles.backdrop}>
        <div className={styles.dialog}>
          <h2>{m.import.completeHeading}</h2>
          <p>{m.import.completeSummary(outcome.created, outcome.skipped)}</p>
          {outcome.errors.length > 0 && (
            <div className={styles.errorList}>
              <p>{m.import.failedCount(outcome.errors.length)}</p>
              <ul>
                {outcome.errors.map((err) => (
                  <li key={err.index}>
                    {m.import.failedRow(
                      err.contact.displayName ?? m.import.unnamedContact,
                      err.message,
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {outcome.offerPickSelf && (
            <p>
              {m.import.whichIsYou}{" "}
              <button type="button" onClick={onPickSelf}>
                {m.import.pickYourself}
              </button>
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" onClick={() => onDone(outcome)}>
              {m.import.done}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const committing = phase === "committing";

  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog}>
        <h2>{m.import.reviewHeading}</h2>
        <p>{m.import.reviewIntro(contacts.length)}</p>
        <ul className={styles.rows}>
          {rows.map((row, index) => (
            <ContactRow
              // Rows are positional — an incoming file has no ids of its own.
              key={index}
              row={row}
              matches={matchesByIndex.get(index) ?? []}
              alreadyStored={storedByIndex.get(index) ?? null}
              onName={(field, value) => setName(index, field, value)}
              onToggleSkip={() => toggleSkip(index)}
              onToggleSelf={() => toggleSelf(index)}
              m={m}
            />
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" onClick={onClose} disabled={committing}>
            {m.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={committing || chosen === 0}
          >
            {committing ? m.import.importing : m.import.importCount(chosen)}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactRow({
  row,
  matches,
  alreadyStored,
  onName,
  onToggleSkip,
  onToggleSelf,
  m,
}: {
  row: Row;
  matches: ImportDuplicateMatch[];
  alreadyStored: ImportAlreadyStored | null;
  onName: (field: "firstName" | "lastName", value: string) => void;
  onToggleSkip: () => void;
  onToggleSelf: () => void;
  m: Messages;
}) {
  const { contact, action } = row;
  const skipped = action === "skip";
  const needsName =
    contact.name.firstName.trim() === "" || contact.name.lastName.trim() === "";
  // Suppressed when the card is known to be one we already hold: "already in
  // Leapsake" is the same news, said with certainty, and saying both would read
  // as two separate problems with one row.
  const topMatch = alreadyStored ? undefined : matches[0];

  return (
    <li className={styles.row} data-skipped={skipped}>
      <div className={styles.rowHead}>
        <div className={styles.nameFields}>
          <input
            aria-label={m.person.firstName}
            placeholder={m.person.firstName}
            value={contact.name.firstName}
            disabled={skipped}
            onChange={(e) => onName("firstName", e.target.value)}
          />
          <input
            aria-label={m.person.lastName}
            placeholder={m.person.lastName}
            value={contact.name.lastName}
            disabled={skipped}
            onChange={(e) => onName("lastName", e.target.value)}
          />
        </div>
        <button type="button" onClick={onToggleSkip}>
          {skipped ? m.import.include : m.import.skip}
        </button>
      </div>

      {needsName && !skipped && (
        <p className={styles.needsName}>{m.import.needsName}</p>
      )}

      {alreadyStored && !skipped && (
        <p className={styles.dupWarning}>
          {m.import.alreadyStored(alreadyStored.name)}
        </p>
      )}

      {/*
        Shown only when the card claims it, so a foreign file never offers this
        at all — and unticked whatever the card says, because agreeing is the
        user's act rather than the file's.
      */}
      {contact.isSelf && !skipped && (
        <label className={styles.selfClaim}>
          <input
            type="checkbox"
            checked={row.setSelf}
            onChange={onToggleSelf}
          />
          {m.import.selfClaim}
        </label>
      )}

      {topMatch && !skipped && (
        <p className={styles.dupWarning}>
          {m.import.duplicateWarning(
            topMatch.tier,
            topMatch.name,
            topMatch.reasons,
          )}
        </p>
      )}

      <ContactDetail contact={contact} m={m} />

      {contact.dropped.length > 0 && (
        <p className={styles.dropped}>
          {m.import.notImported(contact.dropped.map((d) => d.property))}
        </p>
      )}
    </li>
  );
}

function ContactDetail({
  contact,
  m,
}: {
  contact: ParsedContact;
  m: Messages;
}) {
  const bits: string[] = [];
  for (const e of contact.emails)
    bits.push(m.import.labelledValue(e.label, e.address));
  for (const p of contact.phones)
    bits.push(m.import.labelledValue(p.label, p.number));
  for (const a of contact.postals)
    bits.push(m.import.labelledValue(a.label, a.line1));
  if (contact.birthday) {
    bits.push(m.import.birthday(formatBirthday(contact.birthday)));
  }
  // The source's own label, not the kind's — the review's job is to show what
  // the card said, and the label is what the user will recognise.
  for (const d of contact.dates)
    bits.push(m.import.labelledValue(d.label, formatBirthday(d.date)));
  if (bits.length === 0) return null;
  return <p className={styles.detail}>{m.import.detailLine(bits)}</p>;
}

/**
 * A parsed birthday for display. Built from parts rather than a `Date` because a
 * vCard birthday is routinely partial — a month and day with no year is the
 * common case, and there is no date to construct.
 */
function formatBirthday(b: ParsedBirthday): string {
  const month =
    b.month === null
      ? ""
      : new Date(Date.UTC(2001, b.month - 1, 1)).toLocaleDateString(undefined, {
          month: "short",
          timeZone: "UTC",
        });
  const md = month === "" ? "" : `${month}${b.day === null ? "" : ` ${b.day}`}`;
  return [md, b.year].filter((p) => p !== null && p !== "").join(", ");
}
