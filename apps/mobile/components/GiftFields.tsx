import { Pressable, Text, TextInput, View } from "react-native";
import type { GiftIdea } from "@leapsake/schema";
import {
  giftUrlLabel,
  giftUrlOf,
  pastedIntoField,
} from "@leapsake/ui/headless";
import { CheckboxBox } from "./Checkbox";
import { styles } from "../lib/styles";

/** Shortest query the idea suggestions act on, so the title field never dumps the
 *  whole idea list under itself. */
const MIN_SUGGEST_CHARS = 2;

/**
 * A gift as a form holds it: every field as typed, nothing parsed or resolved —
 * the same idea as {@link PersonDraft} and {@link ContactDraft}, and held for the
 * same reason, since a half-typed field has to survive being looked at.
 *
 * It used to carry a `kind` naming which of two arms was live, a list of dated
 * giving rows, and a suggestion's target occasion and date. All three served a
 * data model with a separate dated `gifts` table; there is one table now, and
 * what it holds about a recipient is {@link given}.
 */
export interface GiftDraft {
  title: string;
  /** The link, once the title field has recognised one — see {@link giftUrlOf}. */
  url: string;
  /** Whether they already have it. */
  given: boolean;
}

export function emptyGiftDraft(given = false): GiftDraft {
  return { title: "", url: "", given };
}

/**
 * Whether the row says anything at all — the "Add gift" tap nobody followed
 * through on. Such a row is neither written nor allowed to hold up the Save: an
 * empty row is a question the user declined to answer. See
 * {@link contactRowPending}, which draws the same line for the same reason.
 *
 * A ticked box on a nameless gift is not "something said": the tick is about a
 * gift, and there is no gift.
 */
export function giftDraftEmpty(draft: GiftDraft): boolean {
  return draft.title.trim() === "" && draft.url.trim() === "";
}

/**
 * Whether the row would write cleanly or be skipped — the Save gate.
 *
 * A gift needs a name and nothing else, so the only way to be half-said is to
 * have pasted a link without ever naming the thing.
 */
export function giftDraftValid(draft: GiftDraft): boolean {
  return giftDraftEmpty(draft) || draft.title.trim() !== "";
}

/**
 * What a gift **is** — its name and its link.
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
 *
 * Above it there used to be an Idea / Already-gave-it segmented control, whose
 * answer decided which of two tables the save wrote to and reshaped every field
 * below. One table later, the question is a checkbox on the recipient.
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
    // Load-bearing for the harness — see the note in `PersonFields`.
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
  );
}

/** The one thing a gift says about a recipient: whether they have it yet. */
export function GiftGivenCheckbox({
  label,
  value,
  onChange,
  testID,
}: {
  /** Whose row this is; absent where the form is not told who it is for. */
  label?: string;
  value: boolean;
  onChange: (given: boolean) => void;
  testID?: string;
}) {
  const text =
    label === undefined ? "Already gave it" : `Already gave it to ${label}`;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      accessibilityLabel={text}
      style={[styles.rowWithLead, { paddingVertical: 8 }]}
      onPress={() => onChange(!value)}
    >
      <CheckboxBox checked={value} />
      <Text style={styles.rowText}>{text}</Text>
    </Pressable>
  );
}
