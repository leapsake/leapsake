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
import { type SearchHit, splitDraft } from "@leapsake/schema";
import { useChipDraft, useTypeahead } from "@leapsake/ui/headless";
import { useCore } from "../lib/core-context";
import { highlightMatch } from "../lib/highlightMatch";
import { colors, styles } from "../lib/styles";

const TEXT = {
  matchedOn: "matched on",
  reasonSeparator: ", ",
};

/**
 * A controlled `TextInput` whose `@mentions` and `#tags` read as **chips**, with
 * a typeahead for both — the mobile twin of the web `ChipTextField`. The draft,
 * the two grammars and the picker's results are {@link useChipDraft}'s; this is
 * the React Native half.
 *
 * React Native styles runs of a `TextInput`'s text natively, so the draft goes in
 * as nested `<Text>` children and each chip carries the same tint the desktop
 * backdrop paints. Chips are atomic: the caret rests at their edges but never
 * inside (snapped through the controlled `selection`), and an edit reaching
 * into one takes the whole chip.
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

  // Set by `onKeyPress` for the one `onChangeText` that a Tab caused, so that
  // edit can be replaced by the pick instead of applied.
  const tabPressed = useRef(false);
  // A one-shot forced caret, applied for a single render after a pick or a snap,
  // then released (undefined) so the field returns to uncontrolled selection.
  const [selection, setSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);

  const search = useCallback(
    (query: string) => core.search.query(query),
    [core],
  );
  const chips = useChipDraft({
    grammar,
    value,
    onChange: onChangeText,
    search,
    placeCaret: (caret) => setSelection({ start: caret, end: caret }),
  });
  const { live, activeQuery, results } = chips;
  const open = results.length > 0;

  function pick(hit: SearchHit) {
    chips.pick(hit);
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
          chips.edit(text);
        }}
        onSelectionChange={(e) => {
          const next = e.nativeEvent.selection;
          // Keep the caret out of the chips. A tap that lands inside one is
          // carried to the nearer edge; an arrow step is carried the way it was
          // already going, so ← steps over a whole chip rather than into it.
          const snapped =
            next.start === next.end ? chips.snap(next).end : next.end;
          if (snapped !== next.end) {
            setSelection({ start: snapped, end: snapped });
          } else if (selection !== undefined) {
            // Release the one-shot forced caret once RN has applied it.
            setSelection(undefined);
          }
          chips.moveCaret(snapped);
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
                    {TEXT.matchedOn}{" "}
                    {reasons.map((r, ri) => (
                      <Text key={`${r.facet}:${r.matchedText}`}>
                        {ri > 0 ? TEXT.reasonSeparator : ""}
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
