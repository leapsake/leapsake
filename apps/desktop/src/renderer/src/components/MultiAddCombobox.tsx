import { type ReactNode, useId, useRef, useState } from "react";
import styles from "./MultiAddCombobox.module.css";

/**
 * Shortest query the field acts on. Matches the floor `SearchBar` and the mobile
 * `Typeahead` use, so a one-or-two-letter name behaves the same everywhere.
 */
const MIN_CHARS = 2;

/**
 * How many suggestions to show at once. Matches the mobile `Typeahead`'s cap so
 * the two clients agree on how much of a long list is offered.
 */
const MAX_SUGGESTIONS = 20;

/**
 * A WAI-ARIA combobox for adding items to a list — one pick at a time, without
 * closing.
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
 * Modelled on `SearchBar`'s keyboard and ARIA contract, deliberately as a
 * separate copy rather than a shared abstraction (see the stylesheet's header).
 * Two differences worth knowing: no debounce and no IPC, because the options are
 * already in memory; and Escape clears the query rather than dismissing a
 * persistent surface.
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
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
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

  const open = matches.length > 0;

  function pick(option: T) {
    onPick(option);
    setAnnouncement(`${getLabel(option)} added`);
    // Clear the query but hold focus: the cleared value falls below `minChars`,
    // so the listbox collapses and the next name can be typed straight away.
    setQuery("");
    setActiveIndex(0);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const option = matches[activeIndex];
      if (option) {
        e.preventDefault();
        pick(option);
      }
    }
  }

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  return (
    <div className={styles.container}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
          setAnnouncement("");
        }}
        onKeyDown={onInputKeyDown}
      />
      {open && (
        <ul className={styles.listbox} role="listbox" id={listboxId}>
          {matches.map((option, i) => (
            <li
              key={getKey(option)}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={styles.option}
              // mousedown (not click) fires before the input blurs, so the
              // listbox is still open when the pick lands.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
            >
              {renderOption ? renderOption(option) : getLabel(option)}
            </li>
          ))}
        </ul>
      )}
      <span className={styles.visuallyHidden} aria-live="polite">
        {announcement || (open ? `${matches.length} suggestions` : "")}
      </span>
    </div>
  );
}
