import { type KeyboardEvent, useId, useState } from "react";

/**
 * The listbox half of a WAI-ARIA combobox: which option is active, how the
 * keyboard moves it, and the ids that tie the field to the list.
 *
 * Zero DOM — it returns state and handlers, not markup — so a React Native
 * renderer could drive its own list from the same hook.
 *
 * It deliberately does **not** own the query or fetch anything. The three
 * comboboxes this was extracted from get their query from three different
 * places (local state, a caret position inside a larger text field, a filter
 * box), and `results` may arrive from memory or over IPC — see
 * {@link useDebouncedSearch} for the async case.
 */
export function useTypeahead<T>({
  query,
  results,
  onSelect,
  onEscape,
}: {
  /** The current query. Only used to know when the list is a *new* list. */
  query: string;
  results: readonly T[];
  onSelect: (option: T) => void;
  /**
   * Escape, forwarded with its event. Left to the caller because the three
   * call sites mean genuinely different things by it — clear the field, clear
   * the query, or dismiss the picker for this fragment only — and one of them
   * suppresses the browser default while the others must not.
   */
  onEscape?: (event: KeyboardEvent) => void;
}) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const [lastQuery, setLastQuery] = useState(query);

  // A new query means a new list, so the highlight returns to the top.
  // Adjusting state during render is React's documented way to derive state
  // from a changed input, and unlike an effect it leaves no frame in which the
  // old index points into the new results.
  if (query !== lastQuery) {
    setLastQuery(query);
    setActiveIndex(0);
  }

  const open = results.length > 0;
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      onEscape?.(event);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      const option = results[activeIndex];
      if (option !== undefined) {
        // Only swallow Enter when it actually picks something, so a form's
        // default submit still works when nothing is highlighted.
        event.preventDefault();
        onSelect(option);
      }
    }
  }

  return { open, activeIndex, listboxId, optionId, onKeyDown };
}
