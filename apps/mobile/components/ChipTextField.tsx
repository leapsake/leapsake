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
 * A `TextInput` whose `@mentions` and `#tags` are atomic chips, with a
 * typeahead for both; the draft and grammars are {@link useChipDraft}'s.
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
  /** On the input: an empty `TextInput` has no accessibility text. */
  testID?: string;
}) {
  const prose = grammar === "prose";
  const core = useCore();
  const inputRef = useRef<RNTextInput>(null);

  // Set by `onKeyPress` for the one `onChangeText` that a Tab caused, so that
  // edit can be replaced by the pick instead of applied.
  const tabPressed = useRef(false);
  // A caret forced for one render after a pick or a snap, then released so
  // the field's selection is uncontrolled again.
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
        // Only while open, which guarantees a highlighted row: the one way
        // Return reaches a multiline field without inserting a newline first.
        onSubmitEditing={() => {
          selectActive();
        }}
        onKeyPress={(e) => {
          const key = e.nativeEvent.key;
          tabPressed.current = key === "Tab" || key === "\t";
        }}
        onChangeText={(text) => {
          // A Tab arrives as the character it inserts, which RN cannot refuse,
          // so the pick replaces that edit. Best-effort: UIKit may take it.
          if (tabPressed.current) {
            tabPressed.current = false;
            if (selectActive()) return;
          }
          chips.edit(text);
        }}
        onSelectionChange={(e) => {
          const next = e.nativeEvent.selection;
          // Keep the caret out of the chips: a tap goes to the nearer edge, an
          // arrow step on the way it was going.
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
                // Which row Return will take — the native counterpart of the
                // web listbox's `aria-selected`.
                accessibilityState={{ selected: highlighted }}
                style={[
                  chipStyles.option,
                  highlighted && chipStyles.optionHighlighted,
                ]}
                onPress={() => pick(hit)}
              >
                <Text style={[styles.rowText, { color: colors.accent }]}>
                  {/* The "#" is never part of the match. */}
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
  // Background only, to match desktop's backdrop, which cannot change weight.
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
  // The row Return commits, in the chips' wash.
  optionHighlighted: {
    backgroundColor: colors.accentTint,
  },
};
