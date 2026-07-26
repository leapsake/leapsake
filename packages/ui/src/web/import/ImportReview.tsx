import type { ParsedBirthday, ParsedContact } from "@leapsake/contact-import";
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

/** One incoming contact's likely duplicates, by its position in the file. */
export interface ImportPreviewEntry {
  index: number;
  matches: ImportDuplicateMatch[];
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
    contacts.map((contact) => ({ contact, action: "create" })),
  );
  const [matchesByIndex, setMatchesByIndex] = useState<
    Map<number, ImportDuplicateMatch[]>
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

  async function confirm() {
    setPhase("committing");
    const committed = await onCommit(
      rows.map((row) => ({ action: row.action, contact: row.contact })),
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
              onName={(field, value) => setName(index, field, value)}
              onToggleSkip={() => toggleSkip(index)}
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
  onName,
  onToggleSkip,
  m,
}: {
  row: Row;
  matches: ImportDuplicateMatch[];
  onName: (field: "firstName" | "lastName", value: string) => void;
  onToggleSkip: () => void;
  m: Messages;
}) {
  const { contact, action } = row;
  const skipped = action === "skip";
  const needsName =
    contact.name.firstName.trim() === "" || contact.name.lastName.trim() === "";
  const topMatch = matches[0];

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
