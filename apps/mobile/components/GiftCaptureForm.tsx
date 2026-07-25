import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type {
  CaptureRecipient,
  GiftIdea,
  GiftPartyType,
} from "@leapsake/schema";
import { useCore } from "../lib/core-context";
import { colors, styles } from "../lib/styles";
import { Typeahead } from "./Typeahead";

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

/** Shortest query the idea suggestions act on — the Typeahead's floor, so the
 *  title field never dumps the whole idea list under itself. */
const MIN_SUGGEST_CHARS = 2;

const newDateRow = (): DateRow => ({
  id: crypto.randomUUID(),
  year: "",
  month: "",
  day: "",
});

/** A typed date part as a positive integer, or null when blank/unparseable. */
function num(s: string): number | null {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse a date row into a partial date, or null when wholly blank. A lone day
 *  (no month) drops the day (the day⇒month rule). */
function parseDateRow(
  row: DateRow,
): { year: number | null; month: number | null; day: number | null } | null {
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
 *  each picked recipient on the Gifts screen. Three number fields rather than a
 *  month picker, matching the desktop form: this row repeats, and a partial date
 *  here is a retro-log ("Christmas 1941"), not a milestone's dated fact. */
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
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        Given on… (a date makes it a logged gift, not a suggestion)
      </Text>
      {rows.map((row) => (
        <View key={row.id} style={styles.field}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={row.year}
              onChangeText={(year) => update(row.id, { year })}
              keyboardType="number-pad"
              placeholder="Year"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Year"
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={row.month}
              onChangeText={(month) =>
                // A day is only meaningful alongside a month; clearing the month
                // clears it (the day⇒month rule the parse also enforces).
                update(row.id, { month, ...(month === "" ? { day: "" } : {}) })
              }
              keyboardType="number-pad"
              placeholder="Month"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Month"
            />
            <TextInput
              style={[
                styles.input,
                { flex: 1 },
                row.month.trim() === "" && { opacity: 0.5 },
              ]}
              value={row.day}
              onChangeText={(day) => update(row.id, { day })}
              editable={row.month.trim() !== ""}
              keyboardType="number-pad"
              placeholder="Day"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Day"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            <Text style={[styles.link, styles.danger]}>Remove date</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange([...rows, newDateRow()])}
      >
        <Text style={styles.link}>+ Add a date</Text>
      </Pressable>
    </View>
  );
}

/**
 * The one consolidated "capture a gift" form (plans/gifts.md), ported from the
 * desktop `GiftCaptureForm`. Type a gift's name (autocompleting existing ideas)
 * or paste a URL; that alone captures an **idea**. On the Gifts screen you then
 * add **recipients** (each a suggestion), and dates are entered **per recipient**
 * (a date under Alice is a gift to Alice); on a Person/Pet screen the recipient is
 * fixed and the dates apply to them. Adding one or more dates turns that recipient
 * into that many **givings** — the giver defaults to you. One submit, one
 * transaction (`core.gifts.capture`).
 *
 * `fixedRecipient` (Person/Pet screen) and `recipientCandidates` (Gifts screen)
 * are mutually exclusive: the former hides the recipient picker, the latter shows
 * a multi-add typeahead over people/pets.
 *
 * The title field is a plain `TextInput` with its own suggestion list rather than
 * a {@link Typeahead}: it's desktop's free-text-plus-`<datalist>` input, where an
 * existing idea is a shortcut and a brand-new title is the normal case, so it
 * must never collapse into a "chosen option" row.
 */
export function GiftCaptureForm({
  ideaPool,
  fixedRecipient,
  recipientCandidates,
  startWithGiving = false,
  onSaved,
}: {
  ideaPool: GiftIdea[];
  fixedRecipient?: PartyOption;
  recipientCandidates?: PartyOption[];
  /** Open with one blank date row, so the form reads as "log a giving" rather
   *  than "shortlist an idea" (the completed-gift-reminder hand-off). */
  startWithGiving?: boolean;
  /** Called after a successful save — the screen decides whether that means
   *  reloading in place (an inline section) or navigating away (a create screen). */
  onSaved: () => void;
}) {
  const core = useCore();

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  // Fixed-recipient mode: the one recipient's dates live here.
  const [fixedDates, setFixedDates] = useState<DateRow[]>(() =>
    startWithGiving ? [newDateRow()] : [],
  );
  // Gifts-screen mode: recipients each carry their own dates.
  const [recipients, setRecipients] = useState<RecipientEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenKeys = new Set(
    recipients.map((r) => `${r.option.type}:${r.option.id}`),
  );

  const setRecipientDates = (key: string, dates: DateRow[]) =>
    setRecipients((prev) =>
      prev.map((r) =>
        `${r.option.type}:${r.option.id}` === key ? { ...r, dates } : r,
      ),
    );

  const trimmedTitle = title.trim();
  // Existing ideas the typed title could mean. An exact match is already what
  // submitting does, so it isn't offered as a shortcut to itself.
  const suggestions =
    trimmedTitle.length < MIN_SUGGEST_CHARS
      ? []
      : ideaPool
          .filter(
            (i) =>
              i.title.toLowerCase().includes(trimmedTitle.toLowerCase()) &&
              i.title.toLowerCase() !== trimmedTitle.toLowerCase(),
          )
          .slice(0, 20);

  function reset() {
    setTitle("");
    setUrl("");
    setFixedDates(startWithGiving ? [newDateRow()] : []);
    setRecipients([]);
  }

  async function submit() {
    if (trimmedTitle === "") {
      setError("A gift needs a name.");
      return;
    }
    // An exact (case-insensitive) title match reuses the existing idea rather than
    // minting a duplicate; otherwise it's a new idea. Near-duplicate *different*
    // titles are still allowed (tolerated by design).
    const match = ideaPool.find(
      (i) => i.title.toLowerCase() === trimmedTitle.toLowerCase(),
    );
    const giftIdea = match
      ? { id: match.id }
      : {
          title: trimmedTitle,
          url: url.trim() !== "" ? url.trim() : undefined,
        };

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
      await core.gifts.capture({
        giftIdea,
        recipients: captureRecipients,
      });
      reset();
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const anyDates = fixedRecipient
    ? fixedDates.length > 0
    : recipients.some((r) => r.dates.length > 0);
  const canSubmit = !busy && trimmedTitle !== "";

  return (
    <View style={styles.section}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Gift</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Red Ryder BB Gun"
          placeholderTextColor={colors.muted}
        />
        {suggestions.map((idea) => (
          <Pressable
            key={idea.id}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => setTitle(idea.title)}
          >
            <Text style={styles.rowText}>{idea.title}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Link</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://… (optional)"
          placeholderTextColor={colors.muted}
        />
      </View>

      {fixedRecipient ? (
        <DateRows rows={fixedDates} onChange={setFixedDates} />
      ) : (
        <View style={styles.section}>
          <Typeahead
            multi
            label="For whom? (optional)"
            value={null}
            options={recipientCandidates ?? []}
            exclude={chosenKeys}
            onChange={(option) =>
              option !== null &&
              setRecipients((prev) => [...prev, { option, dates: [] }])
            }
            getKey={(c) => `${c.type}:${c.id}`}
            getLabel={(c) => c.label}
            placeholder="Search people and pets…"
          />
          {recipients.map((r) => {
            const key = `${r.option.type}:${r.option.id}`;
            return (
              <View key={key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{r.option.label}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setRecipients((prev) =>
                        prev.filter(
                          (p) => `${p.option.type}:${p.option.id}` !== key,
                        ),
                      )
                    }
                  >
                    <Text style={[styles.link, styles.danger]}>Remove</Text>
                  </Pressable>
                </View>
                <DateRows
                  rows={r.dates}
                  onChange={(dates) => setRecipientDates(key, dates)}
                />
              </View>
            );
          })}
        </View>
      )}

      {error !== null && (
        <Text style={styles.danger}>Couldn't save: {error}</Text>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => void submit()}
        disabled={!canSubmit}
        style={[styles.button, !canSubmit && { opacity: 0.5 }]}
      >
        <Text style={styles.buttonText}>{anyDates ? "Log gift" : "Add"}</Text>
      </Pressable>
    </View>
  );
}
