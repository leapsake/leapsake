import { type KeyboardEvent, useId, useState } from "react";

/**
 * The listbox half of a WAI-ARIA combobox, with no DOM. It owns neither the
 * query nor the fetch; mobile commits through `selectActive`.
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
  /** Escape, forwarded with its event: each call site means something else. */
  onEscape?: (event: KeyboardEvent) => void;
}) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const [lastQuery, setLastQuery] = useState(query);

  // A new query resets the highlight during render, so no frame pairs the
  // old index with the new results.
  if (query !== lastQuery) {
    setLastQuery(query);
    setActiveIndex(0);
  }

  const open = results.length > 0;
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  /** Commits the highlighted option; returns whether there was one. */
  function selectActive(): boolean {
    const option = results[activeIndex];
    if (option === undefined) return false;
    onSelect(option);
    return true;
  }

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
      // Only swallow Enter when it actually picks something, so a form's
      // default submit still works when nothing is highlighted.
      if (selectActive()) event.preventDefault();
    }
  }

  return { open, activeIndex, listboxId, optionId, onKeyDown, selectActive };
}
