import { useEffect, useRef, useState } from "react";

/** Shortest query worth searching for. Mirrors the search service's own floor. */
const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

/**
 * Query → results, debounced, with stale responses discarded.
 *
 * Two behaviours here are load-bearing and were previously hand-written in each
 * combobox:
 *
 * - **Latest query wins.** Searches can resolve out of order, so each run takes
 *   a token and a response whose token is no longer current is dropped rather
 *   than allowed to flicker in.
 * - **Below the floor clears immediately.** An empty or one-character query
 *   doesn't wait for a round trip to empty the list, and it invalidates any
 *   in-flight response so a late arrival can't repopulate a list the user has
 *   already cleared.
 *
 * `search` is part of the effect's dependencies, so it must be stable — a
 * module-level function, or `useCallback` over the values it closes on. An
 * inline arrow re-runs the search on every render.
 */
export function useDebouncedSearch<T>({
  query,
  search,
  minChars = MIN_CHARS,
  debounceMs = DEBOUNCE_MS,
  enabled = true,
}: {
  query: string;
  search: (query: string) => Promise<T[]>;
  minChars?: number;
  debounceMs?: number;
  /** When false the list stays empty and nothing is fetched. */
  enabled?: boolean;
}): T[] {
  const [results, setResults] = useState<T[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled || query.trim().length < minChars) {
      latest.current++; // invalidate any in-flight response
      setResults([]);
      return;
    }
    const token = ++latest.current;
    const timer = setTimeout(() => {
      void search(query).then((hits) => {
        if (token !== latest.current) return; // a newer query superseded this
        setResults(hits);
      });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, search, minChars, debounceMs, enabled]);

  return results;
}
