import { type ReactNode, useState } from "react";
import { useTypeahead } from "../../headless/useTypeahead.js";
import { Combobox } from "./Combobox.js";

/** Shortest query acted on; search and mobile's `Typeahead` use it too. */
const MIN_CHARS = 2;

/** Suggestions shown at once; the same cap as mobile's `Typeahead`. */
const MAX_SUGGESTIONS = 20;

/** Adds items to a list one pick at a time, staying open between picks. */
export function MultiAddCombobox<T>({
  label,
  placeholder,
  options,
  getKey,
  getLabel,
  onPick,
  renderOption,
  announceAdded,
  announceCount,
  minChars = MIN_CHARS,
}: {
  /** Accessible name for the input, which has no visible label of its own. */
  label: string;
  placeholder: string;
  /** The pool to suggest from, with anything already added filtered out. */
  options: readonly T[];
  getKey: (option: T) => string;
  getLabel: (option: T) => string;
  onPick: (option: T) => void;
  /** Richer row content; defaults to the plain label. */
  renderOption?: (option: T) => ReactNode;
  /** What the live region says after a pick; the field looks unchanged. */
  announceAdded: (label: string) => string;
  announceCount: (count: number) => string;
  minChars?: number;
}) {
  const [query, setQuery] = useState("");
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
    setAnnouncement(announceAdded(getLabel(option)));
    // Clear the query but hold focus: the cleared value falls below `minChars`,
    // so the listbox collapses and the next name can be typed straight away.
    setQuery("");
  }

  const { open, activeIndex, listboxId, optionId, onKeyDown } = useTypeahead({
    query,
    results: matches,
    onSelect: pick,
    // Escape clears the query: the field is not an overlay.
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
      announcement={announcement || (open ? announceCount(matches.length) : "")}
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
