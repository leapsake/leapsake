import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { fetchLinkPreview } from "@leapsake/link-preview";
import type { GiftIdea } from "@leapsake/schema";
import {
  giftUrlLabel,
  giftUrlOf,
  pastedIntoField,
} from "@leapsake/ui/headless";
import { CheckboxBox } from "./Checkbox";
import { styles } from "../lib/styles";

/** Shortest query the idea suggestions act on, so none dumps the whole list. */
const MIN_SUGGEST_CHARS = 2;

/** A gift as a form holds it: every field as typed, nothing parsed. */
export interface GiftDraft {
  title: string;
  /** The link, once the title field recognises one; see {@link giftUrlOf}. */
  url: string;
  /** Whether they already have it. */
  given: boolean;
}

export function emptyGiftDraft(given = false): GiftDraft {
  return { title: "", url: "", given };
}

/**
 * An untouched row, neither written nor holding up the Save. A tick on a
 * nameless gift says nothing: there is no gift.
 */
export function giftDraftEmpty(draft: GiftDraft): boolean {
  return draft.title.trim() === "" && draft.url.trim() === "";
}

/** The Save gate: a gift needs a name, so a link alone is half-said. */
export function giftDraftValid(draft: GiftDraft): boolean {
  return giftDraftEmpty(draft) || draft.title.trim() !== "";
}

/**
 * Name a nameless gift after its link's share card, unless a name is typed
 * first. Whether a lookup is under way.
 */
function useNameFromLink(
  draft: GiftDraft,
  onChange: (draft: GiftDraft) => void,
): boolean {
  const latest = useRef({ draft, onChange });
  latest.current = { draft, onChange };
  const [looking, setLooking] = useState(false);
  const nameless = draft.title.trim() === "";

  useEffect(() => {
    if (draft.url === "" || !nameless) return;
    const lookup = new AbortController();
    setLooking(true);
    void fetchLinkPreview(draft.url, lookup.signal).then((preview) => {
      if (lookup.signal.aborted) return;
      setLooking(false);
      const now = latest.current.draft;
      if (preview?.title && now.url === draft.url && now.title.trim() === "") {
        latest.current.onChange({ ...now, title: preview.title });
      }
    });
    return () => {
      lookup.abort();
      setLooking(false);
    };
  }, [draft.url, nameless]);

  return looking;
}

/**
 * A gift's name and link in one field: a pasted link drops into a chip below.
 * Checked on paste and blur only, since `https://e` already parses.
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
  const lookingUpName = useNameFromLink(draft, onChange);

  // An exact match is what submitting does, so it is not offered.
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

  /** File a recognised link and leave the name alone; else it is the name. */
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
    // An E2E anchor, as in `PersonFields`.
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Gift</Text>
      <TextInput
        testID="gift-title"
        style={styles.input}
        placeholder={
          lookingUpName ? "Looking up its name…" : "Name it, or paste a link"
        }
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
