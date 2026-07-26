import type { GiftOccasion, GiftParty } from "@leapsake/schema";
import { useEffect, useState } from "react";
import {
  type DateFields,
  GiftOccasionFields,
  parseDateFields,
} from "./GiftOccasionFields.js";
import { type GiftOccasionChoice, useGiftsPorts } from "./ports.js";

/**
 * Edit an existing suggestion's or giving's **occasion and date** in place — the
 * one thing about either row that is genuinely revisable (“give it to her at
 * Christmas instead”). Everything else is that row's identity: a suggestion *is*
 * idea × recipient, and a giving is a dated fact, so changing those means a
 * different row, not an edit.
 *
 * The occasion pool is the recipient's — an occasion is about the person the gift
 * is for, whichever end of it you're looking at. It's fetched when the editor
 * opens rather than with the page: the list is only needed once someone edits,
 * and it costs a read per party.
 */
export function GiftAdornmentsEditor({
  kind,
  rowId,
  recipient,
  occasion: initialOccasion,
  date: initialDate,
  onDone,
}: {
  kind: "suggestion" | "giving";
  rowId: string;
  recipient: GiftParty;
  occasion: GiftOccasion | null;
  date: DateFields;
  onDone: () => void;
}) {
  const { loadOccasions, updateSuggestion, updateGiving } = useGiftsPorts();
  const [occasions, setOccasions] = useState<GiftOccasionChoice[]>([]);
  const [occasion, setOccasion] = useState<GiftOccasion | null>(
    initialOccasion,
  );
  const [date, setDate] = useState<DateFields>(initialDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipientType = recipient.type;
  const recipientId = recipient.id;

  useEffect(() => {
    let active = true;
    void loadOccasions({ type: recipientType, id: recipientId }).then(
      (options) => active && setOccasions(options),
    );
    return () => {
      active = false;
    };
  }, [recipientType, recipientId, loadOccasions]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseDateFields(date);
      if (kind === "suggestion") {
        await updateSuggestion(rowId, { occasion, targetDate: parsed });
      } else {
        await updateGiving(rowId, { occasion, date: parsed });
      }
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <GiftOccasionFields
        legend={kind === "suggestion" ? "For…" : "Given on…"}
        occasions={occasions}
        occasion={occasion}
        onOccasionChange={setOccasion}
        date={date}
        onDateChange={setDate}
      />
      {error !== null && <p>Couldn't save: {error}</p>}
      <p>
        <button type="button" disabled={busy} onClick={() => void save()}>
          Save
        </button>{" "}
        <button type="button" disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </p>
    </div>
  );
}
