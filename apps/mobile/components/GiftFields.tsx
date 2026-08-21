import { Pressable, Text, TextInput, View } from "react-native";
import type { GiftIdea } from "@leapsake/schema";
import { formatGiftDate } from "@leapsake/schema";
import {
  type GiftAdornmentKind,
  type GiftOccasionChoice,
  type GivenRow,
  type GivingRow,
  type SuggestionFields,
  giftUrlLabel,
  giftUrlOf,
  givingsOf,
  newGivingRow,
  newSuggestionFields,
  pastedIntoField,
} from "@leapsake/ui/headless";
import { GiftOccasionFields } from "./GiftOccasionFields";
import { SegmentedControl } from "./SegmentedControl";
import { styles } from "../lib/styles";

/** Shortest query the idea suggestions act on, so the title field never dumps the
 *  whole idea list under itself. */
const MIN_SUGGEST_CHARS = 2;

/**
 * A gift as a form holds it: every field as typed, nothing parsed or resolved —
 * the same idea as {@link PersonDraft} and {@link ContactDraft}, and held for the
 * same reason, since a half-typed field has to survive being looked at.
 *
 * Both arms are kept even though only one is in use, exactly as
 * {@link EntityFormValue} keeps both a person and a pet draft: `kind` says which
 * one is read, and holding the other means flipping the segment to look and
 * flipping back costs nothing.
 */
export interface GiftDraft {
  kind: GiftAdornmentKind;
  title: string;
  /** The link, once the title field has recognised one — see {@link giftUrlOf}. */
  url: string;
  givings: GivingRow[];
  suggestion: SuggestionFields;
}

export function emptyGiftDraft(
  kind: GiftAdornmentKind = "suggestion",
): GiftDraft {
  return {
    kind,
    title: "",
    url: "",
    givings: kind === "giving" ? [newGivingRow()] : [],
    suggestion: newSuggestionFields(),
  };
}

/**
 * Whether the row says anything at all — the "Add gift" tap nobody followed
 * through on. Such a row is neither written nor allowed to hold up the Save: an
 * empty row is a question the user declined to answer. See
 * {@link contactRowPending}, which draws the same line for the same reason.
 */
export function giftDraftEmpty(draft: GiftDraft): boolean {
  return (
    draft.title.trim() === "" &&
    draft.url.trim() === "" &&
    givingsOf(draft.givings).length === 0 &&
    draft.suggestion.occasion === null &&
    draft.suggestion.date.year.trim() === "" &&
    draft.suggestion.date.month.trim() === "" &&
    draft.suggestion.date.day.trim() === ""
  );
}

/**
 * Whether the row would write cleanly or be skipped — the Save gate.
 *
 * A gift needs a name and nothing else, so the only way to be half-said is to
 * have picked an occasion, or pasted a link, without ever naming the thing.
 */
export function giftDraftValid(draft: GiftDraft): boolean {
  return giftDraftEmpty(draft) || draft.title.trim() !== "";
}

/**
 * At least one row, so that choosing "Already gave it" has somewhere to say when.
 * A giving with an occasion and no date is still a giving ("at some Christmas"),
 * so the row is never empty of meaning.
 */
const atLeastOneGiving = (rows: GivingRow[]): GivingRow[] =>
  rows.length > 0 ? rows : [newGivingRow()];

/** Answer the Idea / Already gave it question, topping up the date rows the
 *  "gave it" arm needs a first of. What the *other* arm holds is left alone. */
export function withGiftKind(
  draft: GiftDraft,
  kind: GiftAdornmentKind,
): GiftDraft {
  return {
    ...draft,
    kind,
    givings:
      kind === "giving" ? atLeastOneGiving(draft.givings) : draft.givings,
  };
}

/**
 * What a gift **is** — which of the two things it is, its name, and its link.
 *
 * The name and the link share one field. They are never both typed: a gift is
 * either something you thought of, which you name, or something you found, which
 * you paste and then name. So the field takes either, `giftUrlOf` says which just
 * arrived, and a recognised link drops out of the field into a chip beneath it,
 * leaving the field free to go on asking for the name. Pasting a second link
 * replaces the first. This was a permanently-visible "Link (optional)" input that
 * most captures left empty.
 *
 * The detection is only run on a **paste** ({@link pastedIntoField}) and on blur,
 * never on an ordinary keystroke: `https://e` already parses, so a field that
 * checked every character would swallow the first nine of a hand-typed URL and
 * put the rest in the name. Blur is the backstop that catches the hand-typed one
 * once it is finished.
 *
 * The title field is a plain `TextInput` with its own suggestion list rather than
 * a {@link Typeahead}: it's desktop's free-text-plus-`<datalist>` input, where an
 * existing idea is a shortcut and a brand-new title is the normal case, so it
 * must never collapse into a "chosen option" row.
 */
export function GiftIdentityFields({
  draft,
  onChange,
  ideaPool,
}: {
  draft: GiftDraft;
  onChange: (draft: GiftDraft) => void;
  ideaPool: readonly GiftIdea[];
}) {
  const trimmedTitle = draft.title.trim();

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

  /** File a recognised link and leave the name alone; otherwise it's the name. */
  function typed(next: string) {
    const url = pastedIntoField(draft.title, next) ? giftUrlOf(next) : null;
    onChange(url === null ? { ...draft, title: next } : { ...draft, url });
  }

  /** The backstop for a link typed out by hand rather than pasted. */
  function settle() {
    const url = giftUrlOf(draft.title);
    if (url !== null) onChange({ ...draft, title: "", url });
  }

  return (
    <>
      {/*
        The first question, because its answer reshapes everything below it: the
        Idea arm has no date rows at all, the gave-it arm no target. It used to be
        inferred — you discovered you had logged a gift because you had added a
        date — which is why the date row's label had to explain the data model.
      */}
      <SegmentedControl
        testID="gift-kind"
        options={[
          { value: "suggestion", label: "Idea" },
          { value: "giving", label: "Already gave it" },
        ]}
        value={draft.kind}
        onChange={(kind) => onChange(withGiftKind(draft, kind))}
      />

      {/* Load-bearing for the harness — see the note in `PersonFields`. */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Gift</Text>
        <TextInput
          testID="gift-title"
          style={styles.input}
          placeholder="Name it, or paste a link"
          value={draft.title}
          onChangeText={typed}
          onBlur={settle}
        />

        {draft.url !== "" && (
          <View style={styles.rowMeta}>
            <Text style={styles.muted}>🔗 {giftUrlLabel(draft.url)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove link"
              onPress={() => onChange({ ...draft, url: "" })}
            >
              <Text style={[styles.link, styles.danger]}>Remove link</Text>
            </Pressable>
          </View>
        )}

        {suggestions.map((idea) => (
          <Pressable
            key={idea.id}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => onChange({ ...draft, title: idea.title })}
          >
            <Text style={styles.rowText}>{idea.title}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

/**
 * The re-gift guard: what this recipient has *already been given* of the idea
 * being typed. A giving points at the idea, so this is the same
 * `(gift_idea_id, recipient)` read the "✓ given" annotation makes — surfaced
 * here, at the moment it can still change the user's mind, rather than only in
 * the list below.
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

/** The repeatable date rows of the "Already gave it" arm. Each row carries its
 *  own occasion, because givings are per-date: two Christmases are two rows.
 *
 *  There is always one (see {@link atLeastOneGiving}), and the only one has no
 *  Remove: emptying the arm is what the Idea segment above is for. */
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
            kind="giving"
            occasions={occasions}
            occasion={row.occasion}
            onOccasionChange={(occasion) => update(row.id, { occasion })}
            date={row.date}
            onDateChange={(date) => update(row.id, { date })}
          />
          {rows.length > 1 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => onChange(rows.filter((r) => r.id !== row.id))}
            >
              <Text style={[styles.link, styles.danger]}>Remove this date</Text>
            </Pressable>
          )}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange([...rows, newGivingRow()])}
      >
        <Text style={styles.link}>+ Gave it more than once</Text>
      </Pressable>
    </View>
  );
}

/**
 * What one recipient gets: the re-gift guard, then whichever arm the gift's
 * `kind` selected — a single target occasion, or dated giving rows.
 *
 * Takes the two arms as separate props rather than a whole {@link GiftDraft}
 * because the Gifts screen's capture form holds them **per recipient** (a date
 * under Alice is a gift to Alice, not to everyone) while the gift's name and kind
 * are shared across all of them. One gift, many of these.
 */
export function GiftRecipientArm({
  kind,
  label,
  given,
  occasions,
  givings,
  onGivingsChange,
  suggestion,
  onSuggestionChange,
}: {
  kind: GiftAdornmentKind;
  /** Whose arm this is — absent where the form is not told who it is for. */
  label?: string;
  /** What they already have of this idea; empty where nobody can be asked. */
  given: readonly GivenRow[];
  occasions: readonly GiftOccasionChoice[];
  givings: GivingRow[];
  onGivingsChange: (rows: GivingRow[]) => void;
  suggestion: SuggestionFields;
  onSuggestionChange: (fields: SuggestionFields) => void;
}) {
  return (
    <>
      {label !== undefined && (
        <AlreadyGivenNotice label={label} gifts={given} />
      )}
      {kind === "suggestion" ? (
        // Open rather than behind a disclosure: it is now one picker and a row of
        // taps, which is small enough to just show.
        <GiftOccasionFields
          kind="suggestion"
          occasions={occasions}
          occasion={suggestion.occasion}
          onOccasionChange={(occasion) =>
            onSuggestionChange({ ...suggestion, occasion })
          }
          date={suggestion.date}
          onDateChange={(date) => onSuggestionChange({ ...suggestion, date })}
        />
      ) : (
        <GivingRows
          rows={givings}
          occasions={occasions}
          onChange={onGivingsChange}
        />
      )}
    </>
  );
}
