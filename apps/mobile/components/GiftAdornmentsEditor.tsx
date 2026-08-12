import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { GiftOccasionOption } from "@leapsake/core";
import type { GiftOccasion, GiftParty } from "@leapsake/schema";
import { type DateFields, parseDateFields } from "@leapsake/ui/headless";
import { GiftOccasionFields } from "./GiftOccasionFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * Edit an existing suggestion's or giving's **occasion and date** in place, ported
 * from the desktop `GiftAdornmentsEditor` — the one thing about either row that is
 * genuinely revisable ("give it to her at Christmas instead"). Everything else is
 * that row's identity: a suggestion *is* idea × recipient, and a giving is a dated
 * fact, so changing those means a different row, not an edit.
 *
 * The occasion pool is the recipient's (`gifts.occasionsFor`) — an occasion is
 * about the person the gift is for, whichever end of it you're looking at. It's
 * fetched when the editor opens rather than with the screen: the list is only
 * needed once someone edits, and it costs a read per party.
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
  const core = useCore();
  const [occasions, setOccasions] = useState<GiftOccasionOption[]>([]);
  const [occasion, setOccasion] = useState<GiftOccasion | null>(
    initialOccasion,
  );
  const [date, setDate] = useState<DateFields>(initialDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void core.gifts
      .occasionsFor(recipient.type, recipient.id)
      .then((options) => active && setOccasions(options));
    return () => {
      active = false;
    };
  }, [core, recipient.type, recipient.id]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseDateFields(date);
      if (kind === "suggestion") {
        await core.gifts.suggestions.update(rowId, {
          occasion,
          targetDate: parsed,
        });
      } else {
        await core.gifts.given.update(rowId, { occasion, date: parsed });
      }
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <GiftOccasionFields
        label={kind === "suggestion" ? "For…" : "Given on…"}
        occasions={occasions}
        occasion={occasion}
        onOccasionChange={setOccasion}
        date={date}
        onDateChange={setDate}
      />

      {error !== null && (
        <Text style={styles.danger}>Couldn't save: {error}</Text>
      )}

      <View style={[styles.headerActions, { justifyContent: "flex-end" }]}>
        <Pressable accessibilityRole="button" onPress={onDone} disabled={busy}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void save()}
          disabled={busy}
          style={[styles.button, busy && { opacity: 0.5 }]}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}
