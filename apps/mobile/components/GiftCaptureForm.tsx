import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type { CaptureRecipient, GiftIdea } from "@leapsake/schema";
import { formatGiftDate } from "@leapsake/schema";
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
  usePartyContext,
} from "@leapsake/ui/headless";
import { GiftOccasionFields } from "./GiftOccasionFields";
import { HeaderSave } from "./HeaderSave";
import { useGiftPartyLoaders } from "../lib/gifts-ports";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";
import { Typeahead } from "./Typeahead";

/** Shortest query the idea suggestions act on — the Typeahead's floor, so the
 *  title field never dumps the whole idea list under itself. */
const MIN_SUGGEST_CHARS = 2;

/** The repeatable "Given on…" rows — reused for the fixed recipient and for each
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
  occasions: readonly GiftOccasionChoice[];
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
 * The re-gift guard: what this recipient has
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
  gifts: readonly GivenRow[];
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

/**
 * The one consolidated "capture a gift" form — the React Native markup over
 * `@leapsake/ui/headless`'s shared capture logic, which the web
 * `GiftCaptureForm` renders too. Type a gift's name (autocompleting existing ideas)
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
 *
 * Like the entity forms it declares its own native header — `title` plus a
 * right-aligned {@link HeaderSave} — rather than carrying a submit button at the
 * foot of a form this long.
 */
export function GiftCaptureForm({
  title: headerTitle,
  ideaPool,
  fixedRecipient,
  recipientCandidates,
  startWithGiving = false,
  onSaved,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
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
  const partyLoaders = useGiftPartyLoaders();

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

  const chosenKeys = new Set(recipients.map((r) => partyKey(r.option)));

  // One context per party in play — the fixed recipient, or everyone picked.
  const pools = usePartyContext(
    fixedRecipient ? [fixedRecipient] : recipients.map((r) => r.option),
    partyLoaders,
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

    const captureRecipients: CaptureRecipient[] = fixedRecipient
      ? [captureRecipientOf(fixedRecipient, fixedGivings, fixedSuggestion)]
      : recipients.map((r) =>
          captureRecipientOf(r.option, r.givings, r.suggestion),
        );

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

  const canSubmit = !busy && trimmedTitle !== "";

  return (
    <View style={styles.section}>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerRight: () => (
            <HeaderSave
              canSave={canSubmit}
              saving={busy}
              onPress={() => void submit()}
            />
          ),
        }}
      />

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Gift</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} />
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
        <Text style={styles.fieldLabel}>Link (optional)</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {fixedRecipient ? (
        <>
          <AlreadyGivenNotice
            label={fixedRecipient.label}
            gifts={pools.alreadyGiven(fixedRecipient, typedIdea?.id)}
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
            getKey={partyKey}
            getLabel={(c) => c.label}
          />
          {recipients.map((r) => {
            const key = partyKey(r.option);
            return (
              <View key={key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{r.option.label}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setRecipients((prev) => removeRecipient(prev, key))
                    }
                  >
                    <Text style={[styles.link, styles.danger]}>Remove</Text>
                  </Pressable>
                </View>
                <AlreadyGivenNotice
                  label={r.option.label}
                  gifts={pools.alreadyGiven(r.option, typedIdea?.id)}
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
              </View>
            );
          })}
        </View>
      )}

      {error !== null && (
        <Text style={styles.danger}>Couldn't save: {error}</Text>
      )}
    </View>
  );
}
