import { useEffect, useRef, useState } from "react";
import {
  type StyleProp,
  type TextInput as RNTextInput,
  type TextStyle,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  type EntityType,
  type SearchHit,
  activeHashtagQuery,
  activeMentionQuery,
  insertHashtag,
  insertMention,
} from "@leapsake/schema";
import { useCore } from "../lib/core-context";
import { highlightMatch } from "../lib/highlightMatch";
import { colors, styles } from "../lib/styles";

/**
 * Shortest fragment we query for — mirrors the search service's own floor (and the
 * search screen's), so the picker stays quiet on a bare `@` until a character or
 * two is typed. (Kept in sync with `MIN_QUERY_LENGTH` in `search-service`.)
 */
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/**
 * A controlled `TextInput` with a shared `@mention` / `#tag` authoring typeahead,
 * mirroring the desktop `MentionTextField`. Typing `@` then a name opens a
 * People/Pets picker; typing `#` then a word opens an existing-tags picker. Both
 * run off the same `core.search.query` + caret/debounce/list machinery — only
 * which trigger the caret sits in branches: {@link activeMentionQuery} vs {@link
 * activeHashtagQuery} for detection, people/pets vs `tag` for the hit filter, and
 * {@link insertMention}'s `@[Name](type:id)` vs {@link insertHashtag}'s `#name`
 * for the splice. Both tokens stay visible as literal text — rich rendering is the
 * saved `ReminderText`'s job — and the write path re-derives mentions/taggings, so
 * a brand-new `#tag` with no suggestion is still typed and created on save.
 *
 * Selection is tracked with `onSelectionChange` to find the active fragment; on a
 * pick the caret is nudged just past the inserted token via a one-shot controlled
 * `selection`, then released back to uncontrolled. The results list renders inline
 * beneath the field (the parent `ScrollView` keeps
 * `keyboardShouldPersistTaps="handled"` so a tap lands before the keyboard
 * dismisses).
 */
export function MentionTextField({
  value,
  onChangeText,
  style,
  multiline,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  style?: StyleProp<TextStyle>;
  multiline?: boolean;
  placeholder?: string;
}) {
  const core = useCore();
  const inputRef = useRef<RNTextInput>(null);

  // The caret offset drives fragment detection; `null` until the field is
  // touched, so pre-filled edit text doesn't spuriously open the picker.
  const [caret, setCaret] = useState<number | null>(null);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [suppressed, setSuppressed] = useState(false);
  // A one-shot forced caret, applied for a single render after a pick, then
  // released (undefined) so the field returns to uncontrolled selection.
  const [selection, setSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);

  // Latest-query-wins: query promises can resolve out of order, so a stale
  // response (token !== latest) is ignored rather than allowed to flicker in.
  const queryToken = useRef(0);

  // Which inline trigger — `@mention` or `#hashtag` — the caret sits in. A
  // mention fragment spans spaces, so it can overlap a later `#`; when both
  // detectors match, the one whose trigger is nearest the caret (greater `start`)
  // is the live one — i.e. the token the user is currently typing.
  const mention = caret === null ? null : activeMentionQuery(value, caret);
  const hashtag = caret === null ? null : activeHashtagQuery(value, caret);
  const mode: "mention" | "hashtag" | null =
    mention && hashtag
      ? hashtag.start > mention.start
        ? "hashtag"
        : "mention"
      : mention
        ? "mention"
        : hashtag
          ? "hashtag"
          : null;
  const active =
    mode === "hashtag" ? hashtag : mode === "mention" ? mention : null;
  const activeQuery = active?.query ?? null;

  useEffect(() => {
    // No active fragment, dismissed, or below the floor: clear immediately.
    if (
      activeQuery === null ||
      suppressed ||
      activeQuery.trim().length < MIN_QUERY_LENGTH
    ) {
      queryToken.current++; // invalidate any in-flight response
      setResults([]);
      return;
    }
    const token = ++queryToken.current;
    const timer = setTimeout(() => {
      void core.search.query(activeQuery).then((hits) => {
        if (token !== queryToken.current) return; // superseded by a newer query
        // The `#tag` picker keeps only tag hits; the `@mention` picker excludes
        // them (mentions only reference people/pets).
        setResults(
          hits.filter((h) =>
            mode === "hashtag"
              ? h.entityType === "tag"
              : h.entityType !== "tag",
          ),
        );
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [core, activeQuery, mode, suppressed]);

  const open = active !== null && !suppressed && results.length > 0;

  /** Splice the tapped hit's token in and nudge the caret just past it. */
  function pick(hit: SearchHit) {
    if (caret === null) return;
    // A tag hit inserts the bare `#name`; a person/pet hit inserts the
    // id-carrying `@[Name](type:id)` token.
    const { text, caret: nextCaret } =
      mode === "hashtag"
        ? insertHashtag(value, caret, hit.title)
        : insertMention(value, caret, {
            displayName: hit.title,
            targetType: hit.entityType as EntityType, // never "tag" here
            targetId: hit.entityId,
          });
    onChangeText(text);
    setResults([]);
    setCaret(nextCaret);
    setSelection({ start: nextCaret, end: nextCaret });
    queryToken.current++;
    inputRef.current?.focus();
  }

  return (
    <View>
      <TextInput
        ref={inputRef}
        style={style}
        value={value}
        selection={selection}
        onChangeText={(text) => {
          onChangeText(text);
          setSuppressed(false); // typing re-opens the picker after a dismiss
        }}
        onSelectionChange={(e) => {
          setCaret(e.nativeEvent.selection.end);
          // Release the one-shot forced caret once RN has applied it.
          if (selection !== undefined) setSelection(undefined);
        }}
        multiline={multiline}
        autoCapitalize="sentences"
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      />
      {open && (
        <View style={mentionStyles.listbox}>
          {results.map((hit) => {
            const reasons = hit.reasons.filter((r) => r.facet !== "name");
            return (
              <Pressable
                key={`${hit.entityType}:${hit.entityId}`}
                accessibilityRole="button"
                style={mentionStyles.option}
                onPress={() => pick(hit)}
              >
                <Text style={[styles.rowText, { color: colors.accent }]}>
                  {/* Tag hits show the "#" sigil; it sits outside the
                      highlighted run since it's never part of the match. */}
                  {hit.entityType === "tag" ? "#" : ""}
                  {highlightMatch(hit.title, activeQuery ?? "")}
                </Text>
                {reasons.length > 0 && (
                  <Text style={[styles.fieldLabel, { marginTop: 2 }]}>
                    matched on{" "}
                    {reasons.map((r, ri) => (
                      <Text key={`${r.facet}:${r.matchedText}`}>
                        {ri > 0 ? ", " : ""}
                        {r.facet === "tag" ? "#" : ""}
                        {r.matchedText}
                      </Text>
                    ))}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const mentionStyles = {
  // A bordered dropdown beneath the field, echoing the desktop listbox overlay.
  listbox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 4,
    overflow: "hidden" as const,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
};
