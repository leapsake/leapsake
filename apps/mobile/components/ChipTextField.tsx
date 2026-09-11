import { useCallback, useRef, useState } from "react";
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
import { useDebouncedSearch, useTypeahead } from "@leapsake/ui/headless";
import { useCore } from "../lib/core-context";
import { highlightMatch } from "../lib/highlightMatch";
import { colors, styles } from "../lib/styles";

/**
 * A controlled `TextInput` whose `@mentions` and `#tags` read as **chips**, with
 * a typeahead for both — the mobile twin of the desktop `ChipTextField`, and the
 * same two grammars:
 *
 * - **`"prose"`** — a reminder's title/body. `value`/`onChangeText` carry the
 *   *stored* text, mention tokens and all (`@[Violet Bick](person:<uuid>)`), while
 *   the field shows `@Violet Bick`. Only `#`-prefixed runs are tags.
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
 * dismisses). Which suggestion is highlighted, and the debounce in front of the
 * search, come from `@leapsake/ui/headless` — the same two hooks the desktop field
 * uses, so "what does Return commit" has one answer on both clients.
 *
 * ## Committing a suggestion
 *
 * A tap always works. On a hardware keyboard, **Return** commits the highlighted
 * row: `submitBehavior="submit"` — set only while the picker is open — is the one
 * way to make Return reach us on a multiline `TextInput` without inserting a
 * newline first. **Tab** is best-effort by construction. React Native has no
 * refusable key event, so a Tab is caught as the character it inserts and the pick
 * replaces that edit; on Android `onKeyPress` fires for soft-keyboard input only
 * (and no soft keyboard has a Tab key), and on iOS a hardware Tab is often
 * consumed by UIKit's focus navigation before it reaches the field. Where the
 * platform delivers it Tab completes; where it doesn't, Return and tapping do.
 *
 * There is no arrow-key or Escape handling: on a `TextInput` the arrows move the
 * caret and RN surfaces no event to intercept, so the highlight stays on the first
 * row — which is the suggestion the picker is usually open for.
 */
export function ChipTextField({
  grammar = "prose",
  value,
  onChangeText,
  style,
  multiline,
  placeholder,
  testID,
}: {
  /** Which text this field holds, and therefore how it spells its tags. */
  grammar?: "prose" | "tags";
  value: string;
  onChangeText: (value: string) => void;
  style?: StyleProp<TextStyle>;
  multiline?: boolean;
  placeholder?: string;
  /**
   * Harness anchor for the input itself. An empty `TextInput` carries no
   * accessibility text, so two of these on one screen — a reminder's Title and
   * its Details — are indistinguishable to a driver, the same problem the add
   * screen's name fields and the account form's two password fields already
   * carry ids for.
   */
  testID?: string;
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
  // Escape has no key here, but a completed pick still suppresses the picker
  // until the next keystroke — otherwise a tag picked in a tags field re-opens.
  const [suppressed, setSuppressed] = useState(false);
  // Set by `onKeyPress` for the one `onChangeText` that a Tab caused, so that
  // edit can be replaced by the pick instead of applied.
  const tabPressed = useRef(false);
  // A one-shot forced caret, applied for a single render after a pick or a snap,
  // then released (undefined) so the field returns to uncontrolled selection.
  const [selection, setSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);

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

  // The tag picker keeps only tag hits; the `@mention` picker excludes them
  // (mentions only reference people/pets). Memoised on `mode`, because
  // `useDebouncedSearch` re-runs whenever this function's identity changes.
  const searchForMode = useCallback(
    (query: string) =>
      core.search
        .query(query)
        .then((hits) =>
          hits.filter((hit) =>
            mode === "tag"
              ? hit.entityType === "tag"
              : hit.entityType !== "tag",
          ),
        ),
    [core, mode],
  );

  const results = useDebouncedSearch({
    query: activeQuery ?? "",
    search: searchForMode,
    enabled: activeQuery !== null && !suppressed,
  });
  const open = results.length > 0;

  /** Splice the chosen hit in as a set chip and nudge the caret past it. */
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
    // The caret lands at the chip's end, which is not a fragment — but a tag
    // picked in a tags field would re-open on the next keystroke otherwise.
    setSuppressed(true);
    inputRef.current?.focus();
  }

  const { activeIndex, selectActive } = useTypeahead({
    query: activeQuery ?? "",
    results,
    onSelect: pick,
  });

  return (
    <View>
      {/* Children, not `value`: RN takes the text from them, which is what lets
          each chip run carry its own style. */}
      <TextInput
        testID={testID}
        ref={inputRef}
        style={style}
        selection={selection}
        submitBehavior={open ? "submit" : undefined}
        // `open` guarantees a highlighted row, so Return is never swallowed for
        // nothing; with the picker closed the prop is absent and Return means
        // what it always did (a newline here, submit in a single-line field).
        onSubmitEditing={() => {
          selectActive();
        }}
        onKeyPress={(e) => {
          const key = e.nativeEvent.key;
          tabPressed.current = key === "Tab" || key === "\t";
        }}
        onChangeText={(text) => {
          // A Tab arrives as an inserted character rather than a key we can
          // refuse, so the pick stands in for the edit it would have made.
          if (tabPressed.current) {
            tabPressed.current = false;
            if (selectActive()) return;
          }
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
          {results.map((hit, index) => {
            const reasons = hit.reasons.filter((r) => r.facet !== "name");
            const highlighted = index === activeIndex;
            return (
              <Pressable
                key={`${hit.entityType}:${hit.entityId}`}
                accessibilityRole="button"
                // Which row Return will take — the native counterpart of the web
                // listbox's `aria-selected`.
                accessibilityState={{ selected: highlighted }}
                style={[
                  chipStyles.option,
                  highlighted && chipStyles.optionHighlighted,
                ]}
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
  // The row Return commits, in the same wash the chips carry — so the highlight
  // reads as "this is the one that becomes a chip".
  optionHighlighted: {
    backgroundColor: colors.accentTint,
  },
};
