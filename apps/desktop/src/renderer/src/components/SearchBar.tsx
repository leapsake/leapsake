import type { SearchHit } from "@leapsake/schema";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";
import { highlightBirthday, highlightMatch } from "../lib/highlightMatch";
import styles from "./SearchBar.module.css";

/**
 * Shortest query the bar acts on — mirrors the service's own floor so the
 * dropdown clears the instant the term drops below it, rather than waiting for
 * an empty response. (Kept in sync with `MIN_QUERY_LENGTH` in `search-service`.)
 */
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/**
 * The screen a result opens. Tags, holidays, and gift ideas target their own
 * pages; people and pets use their type's base path. A gift idea has no
 * read-only view on desktop, so its actionable page is the edit screen (the same
 * choice the tag page makes for its gift-idea rows).
 */
function pathFor(hit: SearchHit): string {
  switch (hit.entityType) {
    case "tag":
      return `/tags/${hit.entityId}`;
    case "holiday":
      return `/holidays/${hit.entityId}`;
    case "gift_idea":
      return `/gifts/${hit.entityId}/edit`;
    default:
      return `${entityBasePath(hit.entityType)}/${hit.entityId}`;
  }
}

/**
 * Persistent global search, mounted in the app chrome. A WAI-ARIA combobox: the
 * input keeps focus while arrow keys move `aria-activedescendant` over the
 * results listbox, Enter navigates to the active entity, Escape clears. ⌘K (or
 * Ctrl+K) focuses the input from anywhere.
 */
export function SearchBar() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Latest-query-wins: IPC promises can resolve out of order, so a stale
  // response (token !== latest) is ignored rather than allowed to flicker in.
  const queryToken = useRef(0);

  useEffect(() => {
    // Below the floor (incl. empty): clear immediately, no in-flight hold.
    if (term.trim().length < MIN_QUERY_LENGTH) {
      queryToken.current++; // invalidate any in-flight response
      setResults([]);
      return;
    }
    const token = ++queryToken.current;
    const timer = setTimeout(() => {
      void window.api.search.query(term).then((hits) => {
        if (token !== queryToken.current) return; // a newer query superseded this
        setResults(hits);
        setActiveIndex(0);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  // ⌘K / Ctrl+K focuses (and selects) the input from anywhere in the app.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const open = results.length > 0;

  function go(hit: SearchHit) {
    setResults([]);
    setTerm("");
    inputRef.current?.blur(); // drop focus so the result screen takes over
    navigate(pathFor(hit));
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setTerm("");
      setResults([]);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const hit = results[activeIndex];
      if (hit) {
        e.preventDefault();
        go(hit);
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
        aria-label="Search people, pets, tags, holidays, and gift ideas"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-autocomplete="list"
        placeholder="Search… (⌘K)"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={onInputKeyDown}
      />
      {open && (
        <ul className={styles.listbox} role="listbox" id={listboxId}>
          {results.map((hit, i) => {
            const reasons = hit.reasons.filter((r) => r.facet !== "name");
            return (
              <li
                key={`${hit.entityType}:${hit.entityId}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                className={styles.option}
                // mousedown (not click) fires before the input blurs, so the
                // listbox is still open when we navigate.
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(hit);
                }}
              >
                {/* Tag results render with the "#" sigil; the sigil sits outside
                    the highlighted span since it's never part of the match. */}
                {hit.entityType === "tag" && "#"}
                {highlightMatch(hit.title, term)}
                {reasons.length > 0 && (
                  <span className={styles.reason}>
                    matched on{" "}
                    {reasons.map((r, ri) => (
                      <Fragment key={`${r.facet}:${r.matchedText}`}>
                        {ri > 0 && ", "}
                        {r.facet === "tag" && "#"}
                        {r.facet === "birthday"
                          ? highlightBirthday(r.matchedText, term)
                          : highlightMatch(
                              r.matchedText,
                              term,
                              r.facet === "phone"
                                ? "phone"
                                : r.facet === "address"
                                  ? "address"
                                  : "text",
                            )}
                      </Fragment>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <span className={styles.visuallyHidden} aria-live="polite">
        {open ? `${results.length} results` : ""}
      </span>
    </div>
  );
}
