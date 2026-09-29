import { useEffect, useRef, useState } from "react";

/** Shortest query worth searching for; the search service's own floor. */
const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

/**
 * Query to results, debounced; the latest query wins, and one below the floor
 * clears at once. `search` must be stable, as an effect depends on it.
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
