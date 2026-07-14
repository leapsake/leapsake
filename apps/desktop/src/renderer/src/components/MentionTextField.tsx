import {
  type EntityType,
  type SearchHit,
  activeHashtagQuery,
  activeMentionQuery,
  insertHashtag,
  insertMention,
} from "@leapsake/schema";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { highlightMatch } from "../lib/highlightMatch";
import styles from "./SearchBar.module.css";

/**
 * Shortest fragment we query for — mirrors the search service's own floor (and
 * the global `SearchBar`'s), so the picker stays quiet on a bare `@` until a
 * character or two is typed. (Kept in sync with `MIN_QUERY_LENGTH` in
 * `search-service`.)
 */
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/**
 * A controlled text field (single-line `input` or `multiline` `textarea`) with a
 * shared `@mention` / `#tag` authoring typeahead. Typing `@` then a name opens a
 * People/Pets picker; typing `#` then a word opens an existing-tags picker. Both
 * run off the same `core.search.query` + caret/debounce/list machinery — only
 * four things branch on which trigger the caret sits in: which detector runs
 * ({@link activeMentionQuery} vs {@link activeHashtagQuery}), which hits are kept
 * (people/pets vs `tag`), and which insert helper splices the chosen token in
 * ({@link insertMention}'s `@[Name](type:id)` vs {@link insertHashtag}'s `#name`).
 * Both tokens stay visible as literal text — rich rendering is the saved
 * `ReminderText`'s job, not the composer's — and the write path re-derives
 * mentions/taggings from the text, so a brand-new `#tag` with no suggestion is
 * still created on save; the picker only offers completions and never blocks typing.
 *
 * Controlled (so a token can be spliced in) but still carries `name`, so the
 * reminder route action keeps reading it from `FormData` unchanged. The picker's
 * caret/search/list logic lives here; both the Title and Details fields are thin
 * instances of it.
 */
export function MentionTextField({
  name,
  value,
  onChange,
  multiline,
  rows,
  placeholder,
  id,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  id?: string;
}) {
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const listboxId = useId();

  // The caret offset drives fragment detection; `null` until the field is
  // touched, so a fresh field with pre-filled text doesn't spuriously open.
  const [caret, setCaret] = useState<number | null>(null);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Escape suppresses the picker for the current fragment; typing clears it.
  const [suppressed, setSuppressed] = useState(false);

  // Latest-query-wins: search promises can resolve out of order, so a stale
  // response (token !== latest) is ignored rather than allowed to flicker in.
  const queryToken = useRef(0);

  // Which inline trigger — `@mention` or `#hashtag` — the caret sits in. A
  // mention fragment spans spaces, so it can overlap a later `#`; when both
  // detectors match, the one whose trigger is nearest the caret (greater `start`)
  // is the live one — i.e. the token the user is currently typing.
  const mention = caret === null ? null : activeMentionQuery(value, caret);
  const hashtag = caret === null ? null : activeHashtagQuery(value, caret);
  const mode: "mention" | "hashtag" | null =
    mention && hashtag
      ? hashtag.start > mention.start
        ? "hashtag"
        : "mention"
      : mention
        ? "mention"
        : hashtag
          ? "hashtag"
          : null;
  const active =
    mode === "hashtag" ? hashtag : mode === "mention" ? mention : null;
  const activeQuery = active?.query ?? null;

  useEffect(() => {
    // No active fragment, dismissed, or below the floor: clear immediately.
    if (
      activeQuery === null ||
      suppressed ||
      activeQuery.trim().length < MIN_QUERY_LENGTH
    ) {
      queryToken.current++; // invalidate any in-flight response
      setResults([]);
      return;
    }
    const token = ++queryToken.current;
    const timer = setTimeout(() => {
      void window.api.search.query(activeQuery).then((hits) => {
        if (token !== queryToken.current) return; // superseded by a newer query
        // The `#tag` picker keeps only tag hits; the `@mention` picker excludes
        // them (mentions only reference people/pets).
        setResults(
          hits.filter((h) =>
            mode === "hashtag"
              ? h.entityType === "tag"
              : h.entityType !== "tag",
          ),
        );
        setActiveIndex(0);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [activeQuery, mode, suppressed]);

  const open = active !== null && !suppressed && results.length > 0;

  /** Splice the chosen hit's token in, then restore focus + caret past it. */
  function pick(hit: SearchHit) {
    if (caret === null) return;
    // A tag hit inserts the bare `#name`; a person/pet hit inserts the
    // id-carrying `@[Name](type:id)` token.
    const { text, caret: nextCaret } =
      mode === "hashtag"
        ? insertHashtag(value, caret, hit.title)
        : insertMention(value, caret, {
            displayName: hit.title,
            targetType: hit.entityType as EntityType, // never "tag" here
            targetId: hit.entityId,
          });
    onChange(text);
    setResults([]);
    queryToken.current++;
    // The value updates on re-render; restore the caret after the DOM catches up.
    requestAnimationFrame(() => {
      const el = fieldRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  }

  function onFieldChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    onChange(e.target.value);
    setCaret(e.target.selectionStart);
    setSuppressed(false); // typing re-opens the picker after an Escape
  }

  // Keep the fragment in step with caret-only moves (arrow keys, clicks).
  function onFieldSelect(
    e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    setCaret(e.currentTarget.selectionStart);
  }

  function onFieldKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setSuppressed(true);
      }
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
        pick(hit);
      }
    }
  }

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  const shared = {
    ref: fieldRef,
    id,
    name,
    value,
    placeholder,
    role: "combobox" as const,
    "aria-expanded": open,
    "aria-controls": listboxId,
    "aria-activedescendant": open ? optionId(activeIndex) : undefined,
    "aria-autocomplete": "list" as const,
    onChange: onFieldChange,
    onSelect: onFieldSelect,
    onKeyDown: onFieldKeyDown,
  };

  return (
    <span className={styles.container}>
      {multiline ? (
        <textarea {...shared} rows={rows} />
      ) : (
        <input {...shared} type="text" />
      )}
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
                // mousedown (not click) fires before the field blurs, so the
                // listbox is still mounted when we splice the token in.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(hit);
                }}
              >
                {/* Tag hits show the "#" sigil; it sits outside the highlighted
                    span since it's never part of the match (mirrors SearchBar). */}
                {hit.entityType === "tag" && "#"}
                {highlightMatch(hit.title, activeQuery ?? "")}
                {reasons.length > 0 && (
                  <span className={styles.reason}>
                    matched on{" "}
                    {reasons.map((r, ri) => (
                      <Fragment key={`${r.facet}:${r.matchedText}`}>
                        {ri > 0 && ", "}
                        {r.facet === "tag" && "#"}
                        {r.matchedText}
                      </Fragment>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}
