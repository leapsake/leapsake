import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { GiftForRecipient, GiftOccasionOption } from "@leapsake/core";
import type {
  CaptureRecipient,
  GiftIdea,
  GiftOccasion,
  GiftPartyType,
} from "@leapsake/schema";
import { formatGiftDate } from "@leapsake/schema";
import {
  type DateFields,
  GiftOccasionFields,
  emptyDate,
  parseDateFields,
} from "./GiftOccasionFields";
import { useCore } from "../lib/core-context";
import { colors, styles } from "../lib/styles";
import { Typeahead } from "./Typeahead";

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

/** Shortest query the idea suggestions act on — the Typeahead's floor, so the
 *  title field never dumps the whole idea list under itself. */
const MIN_SUGGEST_CHARS = 2;

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
    <View style={styles.section}>
      {rows.map((row) => (
        <View key={row.id} style={styles.section}>
          <GiftOccasionFields
            label="Given on… (a date makes it a logged gift, not a suggestion)"
            occasions={occasions}
            occasion={row.occasion}
            onOccasionChange={(occasion) => update(row.id, { occasion })}
            date={row.date}
            onDateChange={(date) => update(row.id, { date })}
          />
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
        onPress={() => onChange([...rows, newGivingRow()])}
      >
        <Text style={styles.link}>+ Add a date</Text>
      </Pressable>
    </View>
  );
}

/**
 * The suggestion arm's "For…" disclosure — collapsed behind a link by default (RN
 * has no `<details>`), so the common case (type a gift, pick a person, done) stays
 * two fields. Only offered while the recipient has no dates: with dates it's a
 * giving, and each giving carries its own occasion instead.
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
  const [open, setOpen] = useState(set);

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <Text style={styles.link}>For… (an occasion or a target date)</Text>
      </Pressable>
    );
  }

  return (
    <GiftOccasionFields
      label="For…"
      occasions={occasions}
      occasion={fields.occasion}
      onOccasionChange={(occasion) => onChange({ ...fields, occasion })}
      date={fields.date}
      onDateChange={(date) => onChange({ ...fields, date })}
    />
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
    <Text style={styles.danger}>
      ⚠ {label} was already given this
      {when.length > 0 ? ` — ${when.join(", ")}` : ""}.
    </Text>
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
  const core = useCore();
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
        core.gifts.occasionsFor(party, id),
        core.gifts.given.listForRecipient(party, id),
      ]).then(([occasions, given]) => {
        if (active) {
          setPools((prev) => new Map(prev).set(key, { occasions, given }));
        }
      });
    }
    return () => {
      active = false;
    };
  }, [core, wanted]);

  return pools;
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
 *
 * Both arms can name an **occasion** — a milestone of the recipient's or a holiday
 * they observe. A giving carries one per date row (two Christmases are two rows);
 * a suggestion carries one alongside its *target* date, behind a collapsed "For…"
 * link so the common case stays two fields.
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

  const chosenKeys = new Set(
    recipients.map((r) => `${r.option.type}:${r.option.id}`),
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

  // The exact-title match submitting would reuse. A brand-new title can't have
  // been given before, so the re-gift guard keys off the same match.
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

  async function submit() {
    if (trimmedTitle === "") {
      setError("A gift needs a name.");
      return;
    }
    // An exact (case-insensitive) title match reuses the existing idea rather than
    // minting a duplicate; otherwise it's a new idea. Near-duplicate *different*
    // titles are still allowed (tolerated by design).
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
    ? fixedGivings.length > 0
    : recipients.some((r) => r.givings.length > 0);
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
        <View style={styles.section}>
          <Typeahead
            multi
            label="For whom? (optional)"
            value={null}
            options={recipientCandidates ?? []}
            exclude={chosenKeys}
            onChange={(option) =>
              option !== null &&
              setRecipients((prev) => [
                ...prev,
                { option, givings: [], suggestion: newSuggestionFields() },
              ])
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
