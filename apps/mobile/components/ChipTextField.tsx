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
  type ComposerDraft,
  type EntityType,
  type SearchHit,
  activeMentionQuery,
  activeTagQuery,
  applyDraftEdit,
  draftFromMarkup,
  draftFromTagField,
  insertMentionInDraft,
  insertTagInDraft,
  markupFromDraft,
  snapCaret,
  splitDraft,
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
 * A controlled `TextInput` whose `@mentions` and `#tags` read as **chips**, with
 * a typeahead for both — the mobile twin of the desktop `ChipTextField`, and the
 * same two grammars:
 *
 * - **`"prose"`** — a reminder's title/body. `value`/`onChangeText` carry the
 *   *stored* text, mention tokens and all (`@[Alice Ng](person:<uuid>)`), while
 *   the field shows `@Alice Ng`. Only `#`-prefixed runs are tags.
 * - **`"tags"`** — a Person/Pet/GiftIdea Tags field, where the text *is* the
 *   stored value and every word is a tag (see `parseTagNames`), so every word
 *   chips.
 *
 * Which trigger the caret sits in decides three things: which detector runs
 * ({@link activeMentionQuery} vs {@link activeTagQuery}), which hits are kept
 * (people/pets vs `tag`), and which insert helper splices the choice in. The
 * draft ({@link ComposerDraft}) is state rather than something re-derived from
 * `value`, because a chip is partly invisible in the text — a `#family` being
 * typed and one already committed read the same, and only the second is a chip.
 *
 * React Native styles runs of a `TextInput`'s text natively, so the draft goes in
 * as nested `<Text>` children and each chip carries the same tint the desktop
 * backdrop paints. Chips are atomic: the caret rests at their edges but never
 * inside ({@link snapCaret}, applied through the controlled `selection`), and an
 * edit reaching into one takes the whole chip ({@link applyDraftEdit}). Both
 * rules live in `@leapsake/schema`, so the two clients cannot drift.
 *
 * The results list renders inline beneath the field (the parent `ScrollView`
 * keeps `keyboardShouldPersistTaps="handled"` so a tap lands before the keyboard
 * dismisses).
 */
export function ChipTextField({
  grammar = "prose",
  value,
  onChangeText,
  style,
  multiline,
  placeholder,
}: {
  /** Which text this field holds, and therefore how it spells its tags. */
  grammar?: "prose" | "tags";
  value: string;
  onChangeText: (value: string) => void;
  style?: StyleProp<TextStyle>;
  multiline?: boolean;
  placeholder?: string;
}) {
  const prose = grammar === "prose";
  const core = useCore();
  const inputRef = useRef<RNTextInput>(null);

  // The caret offset drives fragment detection; `null` until the field is
  // touched, so pre-filled edit text doesn't spuriously open the picker.
  const [caret, setCaret] = useState<number | null>(null);
  // Where the caret was before the move being handled — the direction an arrow
  // key was travelling, which is what carries it over a chip rather than into it.
  const previousCaret = useRef<number | null>(null);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [suppressed, setSuppressed] = useState(false);
  // A one-shot forced caret, applied for a single render after a pick or a snap,
  // then released (undefined) so the field returns to uncontrolled selection.
  const [selection, setSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);

  // Latest-query-wins: query promises can resolve out of order, so a stale
  // response (token !== latest) is ignored rather than allowed to flicker in.
  const queryToken = useRef(0);

  const seed = (text: string): ComposerDraft =>
    prose ? draftFromMarkup(text) : draftFromTagField(text);
  const serialize = (next: ComposerDraft) =>
    prose ? markupFromDraft(next) : next.text;

  const [draft, setDraft] = useState(() => seed(value));
  // The value changed under us (a reset, a different record): re-seed from it.
  // Everything the field itself does goes through `commit`, which keeps the two
  // in step, so this only fires for changes that didn't come from here.
  const live = serialize(draft) === value ? draft : seed(value);

  /**
   * Push an edited draft out as stored text, and put the caret where the edit
   * says it belongs. `force` only when the field's own caret is now wrong — a
   * pick, or an edit that took a whole chip; driving `selection` on every
   * keystroke is what fights the platform mid-composition.
   */
  function commit(next: ComposerDraft, nextCaret: number, force: boolean) {
    setDraft(next);
    onChangeText(serialize(next));
    setCaret(nextCaret);
    previousCaret.current = nextCaret;
    if (force) setSelection({ start: nextCaret, end: nextCaret });
  }

  // Which inline trigger — `@mention` or a tag — the caret sits in. A mention
  // fragment spans spaces, so it can overlap a later tag; when both detectors
  // match, the one whose trigger is nearest the caret (greater `start`) is the
  // live one — i.e. the token the user is currently typing.
  const mention =
    !prose || caret === null
      ? null
      : activeMentionQuery(live.text, caret, live.spans);
  const tag = caret === null ? null : activeTagQuery(live, caret);
  const mode: "mention" | "tag" | null =
    mention && tag
      ? tag.start > mention.start
        ? "tag"
        : "mention"
      : mention
        ? "mention"
        : tag
          ? "tag"
          : null;
  const active = mode === "tag" ? tag : mode === "mention" ? mention : null;
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
        // The tag picker keeps only tag hits; the `@mention` picker excludes
        // them (mentions only reference people/pets).
        setResults(
          hits.filter((h) =>
            mode === "tag" ? h.entityType === "tag" : h.entityType !== "tag",
          ),
        );
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [core, activeQuery, mode, suppressed]);

  const open = active !== null && !suppressed && results.length > 0;

  /** Splice the tapped hit in as a set chip and nudge the caret past it. */
  function pick(hit: SearchHit) {
    if (caret === null) return;
    const inserted =
      mode === "tag"
        ? insertTagInDraft(live, caret, hit.title)
        : insertMentionInDraft(live, caret, {
            displayName: hit.title,
            targetType: hit.entityType as EntityType, // never "tag" here
            targetId: hit.entityId,
          });
    commit(inserted.draft, inserted.caret, true);
    setResults([]);
    queryToken.current++;
    inputRef.current?.focus();
  }

  return (
    <View>
      {/* Children, not `value`: RN takes the text from them, which is what lets
          each chip run carry its own style. */}
      <TextInput
        ref={inputRef}
        style={style}
        selection={selection}
        onChangeText={(text) => {
          // The field hands back displayed text; chips move, grow or go whole.
          const edited = applyDraftEdit(live, text);
          commit(edited.draft, edited.caret, edited.tookChip);
          setSuppressed(false); // typing re-opens the picker after a dismiss
        }}
        onSelectionChange={(e) => {
          const next = e.nativeEvent.selection;
          // Keep the caret out of the chips. A tap that lands inside one is
          // carried to the nearer edge; an arrow step is carried the way it was
          // already going, so ← steps over a whole chip rather than into it.
          const snapped =
            next.start === next.end
              ? snapCaret(live.spans, next.end, previousCaret.current)
              : next.end;
          if (snapped !== next.end) {
            setSelection({ start: snapped, end: snapped });
          } else if (selection !== undefined) {
            // Release the one-shot forced caret once RN has applied it.
            setSelection(undefined);
          }
          previousCaret.current = snapped;
          setCaret(snapped);
        }}
        multiline={multiline}
        autoCapitalize={prose ? "sentences" : "none"}
        autoCorrect={!prose ? false : undefined}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      >
        {splitDraft(live).map((run, i) => (
          <Text
            key={i}
            style={run.kind === "text" ? undefined : chipStyles.chip}
          >
            {run.text}
          </Text>
        ))}
      </TextInput>
      {open && (
        <View style={chipStyles.listbox}>
          {results.map((hit) => {
            const reasons = hit.reasons.filter((r) => r.facet !== "name");
            return (
              <Pressable
                key={`${hit.entityType}:${hit.entityId}`}
                accessibilityRole="button"
                style={chipStyles.option}
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

const chipStyles = {
  // The tint behind an `@Name` or a `#tag` as it is typed. Background only — the
  // desktop field paints the same tint from a backdrop layer that can't afford a
  // weight or size change (see ChipTextField.module.css), and the two should
  // read the same.
  chip: {
    backgroundColor: colors.accentTint,
  },
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
