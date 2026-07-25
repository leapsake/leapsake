import type { ParsedBirthday, ParsedContact } from "@leapsake/contact-import";
import type { DuplicateMatch, ImportResult } from "@leapsake/core";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useRevalidator } from "react-router-dom";
import styles from "./ImportOverlay.module.css";

/**
 * The review step: after a dropped vCard is parsed, show what will be imported —
 * per contact its name (editable, so a mononym / organisation card with no last
 * name can be fixed before commit), its contact methods and birthday, anything
 * that won't be imported, and a flag when it looks like someone already in
 * Leapsake — then commit only on the user's confirm. Duplicate flags come from
 * `import.preview`; the actual write is `import.commit`.
 */

interface Row {
  contact: ParsedContact;
  action: "create" | "skip";
}

const TIER_LABEL: Record<string, string> = {
  high: "Very likely already in Leapsake",
  medium: "Possibly already in Leapsake",
};

export function ImportReview({
  contacts,
  onClose,
}: {
  contacts: ParsedContact[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const [rows, setRows] = useState<Row[]>(() =>
    contacts.map((contact) => ({ contact, action: "create" })),
  );
  const [matchesByIndex, setMatchesByIndex] = useState<
    Map<number, DuplicateMatch[]>
  >(new Map());
  const [phase, setPhase] = useState<"review" | "committing" | "done">(
    "review",
  );
  const [result, setResult] = useState<ImportResult | null>(null);
  // After a successful import, prompt the user to pick themselves if they haven't
  // yet — a natural moment now that there's a list to pick from.
  // A lookup failure just leaves it false (no nudge, no error).
  const [promptSelf, setPromptSelf] = useState(false);

  // Fetch likely-duplicate flags once; a failure just leaves rows unflagged.
  useEffect(() => {
    let live = true;
    void window.api.import.preview(contacts).then((preview) => {
      if (!live) return;
      setMatchesByIndex(new Map(preview.map((p) => [p.index, p.matches])));
    });
    return () => {
      live = false;
    };
  }, [contacts]);

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
    const decisions = rows.map((row) => ({
      action: row.action,
      contact: row.contact,
    }));
    const imported = await window.api.import.commit(decisions);
    setResult(imported);
    // Offer the pick-yourself prompt only when something was imported and no self
    // is set yet — there's now a list to pick from.
    const self = await window.api.self.get().catch(() => undefined);
    setPromptSelf(imported.created > 0 && self === undefined);
    setPhase("done");
  }

  async function finish() {
    onClose();
    // Reflect the new people wherever the user is; then land on the list.
    revalidator.revalidate();
    // The per-row flags above only score each incoming contact against people who
    // already existed. Two contacts *within* one import that duplicate each other
    // are invisible to that pass, as is a match the user chose to import anyway —
    // so once the rows are committed, ask the detector and route to the review if
    // it has anything. Unscoped: an import can implicate many people at once.
    const outstanding =
      result !== null && result.created > 0
        ? await window.api.duplicates.count().catch(() => 0)
        : 0;
    navigate(outstanding > 0 ? "/duplicates" : "/people");
  }

  function pickSelf() {
    onClose();
    revalidator.revalidate();
    navigate("/people?pick=self");
  }

  if (phase === "done" && result) {
    return (
      <div className={styles.backdrop}>
        <div className={styles.dialog}>
          <h2>Import complete</h2>
          <p>
            Imported {result.created}{" "}
            {result.created === 1 ? "person" : "people"}
            {result.skipped > 0 ? `, skipped ${result.skipped}` : ""}.
          </p>
          {result.errors.length > 0 && (
            <div className={styles.errorList}>
              <p>Couldn’t import {result.errors.length}:</p>
              <ul>
                {result.errors.map((err) => (
                  <li key={err.index}>
                    {err.contact.displayName ?? "Unnamed contact"} —{" "}
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {promptSelf && (
            <p>
              Which of these is you?{" "}
              <button type="button" onClick={pickSelf}>
                Pick yourself
              </button>
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" onClick={() => void finish()}>
              Done
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
        <h2>Import contacts</h2>
        <p>
          Found {contacts.length}{" "}
          {contacts.length === 1 ? "contact" : "contacts"} in the dropped file.
          Review what will be imported, then confirm.
        </p>
        <ul className={styles.rows}>
          {rows.map((row, index) => (
            <ContactRow
              key={index}
              row={row}
              matches={matchesByIndex.get(index) ?? []}
              onName={(field, value) => setName(index, field, value)}
              onToggleSkip={() => toggleSkip(index)}
            />
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" onClick={onClose} disabled={committing}>
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={committing || chosen === 0}
          >
            {committing ? "Importing…" : `Import ${chosen}`}
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
}: {
  row: Row;
  matches: DuplicateMatch[];
  onName: (field: "firstName" | "lastName", value: string) => void;
  onToggleSkip: () => void;
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
            aria-label="First name"
            placeholder="First name"
            value={contact.name.firstName}
            disabled={skipped}
            onChange={(e) => onName("firstName", e.target.value)}
          />
          <input
            aria-label="Last name"
            placeholder="Last name"
            value={contact.name.lastName}
            disabled={skipped}
            onChange={(e) => onName("lastName", e.target.value)}
          />
        </div>
        <button type="button" onClick={onToggleSkip}>
          {skipped ? "Include" : "Skip"}
        </button>
      </div>

      {needsName && !skipped && (
        <p className={styles.needsName}>
          Needs a first and last name before it can be imported.
        </p>
      )}

      {topMatch && !skipped && (
        <p className={styles.dupWarning}>
          {TIER_LABEL[topMatch.tier] ?? topMatch.tier}: matches{" "}
          <strong>{topMatch.name}</strong> ({topMatch.reasons.join("; ")}). Skip
          to avoid a duplicate.
        </p>
      )}

      <ContactDetail contact={contact} />

      {contact.dropped.length > 0 && (
        <p className={styles.dropped}>
          Not imported: {contact.dropped.map((d) => d.property).join(", ")}
        </p>
      )}
    </li>
  );
}

function ContactDetail({ contact }: { contact: ParsedContact }) {
  const bits: string[] = [];
  for (const e of contact.emails) bits.push(`${e.label}: ${e.address}`);
  for (const p of contact.phones) bits.push(`${p.label}: ${p.number}`);
  for (const a of contact.postals) bits.push(`${a.label}: ${a.line1}`);
  if (contact.birthday)
    bits.push(`Birthday: ${formatBirthday(contact.birthday)}`);
  if (bits.length === 0) return null;
  return <p className={styles.detail}>{bits.join(" · ")}</p>;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatBirthday(b: ParsedBirthday): string {
  const md =
    b.month !== null
      ? `${MONTHS[b.month - 1] ?? b.month}${b.day !== null ? ` ${b.day}` : ""}`
      : "";
  return [md, b.year].filter((p) => p !== null && p !== "").join(", ");
}
