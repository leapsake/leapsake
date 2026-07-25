import { type ReactNode, useState } from "react";
import { useTypeahead } from "../../headless/useTypeahead.js";
import { Combobox } from "./Combobox.js";

/**
 * Shortest query the field acts on. Matches the floor the global search bar and
 * the mobile `Typeahead` use, so a one-or-two-letter name behaves the same
 * everywhere.
 */
const MIN_CHARS = 2;

/**
 * How many suggestions to show at once. Matches the mobile `Typeahead`'s cap so
 * the two clients agree on how much of a long list is offered.
 */
const MAX_SUGGESTIONS = 20;

/**
 * A combobox for adding items to a list — one pick at a time, without closing.
 *
 * **The field stays open across picks.** Each selection fires `onPick` and
 * clears the query but keeps focus, so adding ten people is ten
 * type-then-Enter cycles rather than ten round trips through a modal. That
 * behaviour is the whole reason this replaced the select-all checklist: an
 * autocomplete that closed on every pick would trade a cumbersome control for a
 * slow one, and `plans/holidays/research.md` §2.12's case for bulk assignment
 * was outweighed by the common one-person case, not refuted.
 *
 * The caller owns the added list and passes `options` already filtered, so
 * anything picked simply stops being suggested. There is no `value` — this
 * control never holds a selection of its own.
 *
 * Unlike the search-backed comboboxes it neither debounces nor fetches: the
 * options are already in memory, so matching is a filter over them.
 */
export function MultiAddCombobox<T>({
  label,
  placeholder,
  options,
  getKey,
  getLabel,
  onPick,
  renderOption,
  minChars = MIN_CHARS,
}: {
  /** Accessible name for the input, which has no visible label of its own. */
  label: string;
  placeholder: string;
  /**
   * The pool to suggest from. The caller filters out anything already added, so
   * the list shrinks as you go and nothing can be picked twice.
   */
  options: readonly T[];
  getKey: (option: T) => string;
  getLabel: (option: T) => string;
  onPick: (option: T) => void;
  /** Richer row content; defaults to the plain label. */
  renderOption?: (option: T) => ReactNode;
  minChars?: number;
}) {
  const [query, setQuery] = useState("");
  // What the live region announces after a pick. Without it, a screen-reader
  // user gets no confirmation at all: the field looks unchanged because it
  // deliberately stays open, and the row that was added is elsewhere in the DOM.
  const [announcement, setAnnouncement] = useState("");

  const trimmed = query.trim().toLowerCase();
  const matches =
    trimmed.length < minChars
      ? []
      : options
          .filter((option) => getLabel(option).toLowerCase().includes(trimmed))
          .slice(0, MAX_SUGGESTIONS);

  function pick(option: T) {
    onPick(option);
    setAnnouncement(`${getLabel(option)} added`);
    // Clear the query but hold focus: the cleared value falls below `minChars`,
    // so the listbox collapses and the next name can be typed straight away.
    setQuery("");
  }

  const { open, activeIndex, listboxId, optionId, onKeyDown } = useTypeahead({
    query,
    results: matches,
    onSelect: pick,
    // Escape clears the query rather than dismissing anything: this field is a
    // permanent part of its section, not an overlay.
    onEscape: () => setQuery(""),
  });

  return (
    <Combobox
      results={matches}
      activeIndex={activeIndex}
      listboxId={listboxId}
      optionId={optionId}
      getKey={getKey}
      onSelect={pick}
      renderOption={(option) =>
        renderOption ? renderOption(option) : getLabel(option)
      }
      announcement={
        announcement || (open ? `${matches.length} suggestions` : "")
      }
      renderField={(aria) => (
        <input
          type="text"
          aria-label={label}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAnnouncement("");
          }}
          onKeyDown={onKeyDown}
          {...aria}
        />
      )}
    />
  );
}
