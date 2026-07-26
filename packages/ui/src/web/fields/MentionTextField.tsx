import {
  type EntityType,
  type SearchHit,
  activeHashtagQuery,
  activeMentionQuery,
  insertHashtag,
  insertMention,
} from "@leapsake/schema";
import { useDebouncedSearch } from "../../headless/useDebouncedSearch.js";
import { useTypeahead } from "../../headless/useTypeahead.js";
import { Fragment, useCallback, useRef, useState } from "react";
import { highlightMatch } from "../highlight.js";
import { Combobox, ComboboxOptionDetail } from "../primitives/Combobox.js";

/**
 * A controlled text field (single-line `input` or `multiline` `textarea`) with a
 * shared `@mention` / `#tag` authoring typeahead. Typing `@` then a name opens a
 * People/Pets picker; typing `#` then a word opens an existing-tags picker. Both
 * run off the same search + caret machinery — only three things branch on which
 * trigger the caret sits in: which detector runs ({@link activeMentionQuery} vs
 * {@link activeHashtagQuery}), which hits are kept (people/pets vs `tag`), and
 * which insert helper splices the chosen token in ({@link insertMention}'s
 * `@[Name](type:id)` vs {@link insertHashtag}'s `#name`).
 *
 * Both tokens stay visible as literal text — rich rendering is the saved
 * `ReminderText`'s job, not the composer's — and the write path re-derives
 * mentions/taggings from the text, so a brand-new `#tag` with no suggestion is
 * still created on save; the picker only offers completions and never blocks
 * typing.
 *
 * Controlled (so a token can be spliced in) but still carries `name`, so the
 * write path keeps reading it from `FormData` unchanged. The listbox,
 * keyboard handling and debounce come from `@leapsake/ui`; what stays here is the
 * caret work — finding the fragment under the cursor and splicing the token back
 * in.
 */
export function MentionTextField({
  name,
  value,
  onChange,
  search,
  multiline,
  rows,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Look up people, pets and tags for the picker. Injected rather than reached
   * for, and it must be stable (a module-level function, or `useCallback`) —
   * `useDebouncedSearch` takes it as an effect dependency.
   */
  search: (query: string) => Promise<SearchHit[]>;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // The caret offset drives fragment detection; `null` until the field is
  // touched, so a fresh field with pre-filled text doesn't spuriously open.
  const [caret, setCaret] = useState<number | null>(null);
  // Escape — and a completed pick — suppress the picker until the user types.
  const [suppressed, setSuppressed] = useState(false);

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

  // The `#tag` picker keeps only tag hits; the `@mention` picker excludes them
  // (mentions only reference people/pets). Memoised on `mode`, because
  // `useDebouncedSearch` re-runs whenever this function's identity changes.
  const searchForMode = useCallback(
    (query: string) =>
      search(query).then((hits) =>
        hits.filter((hit) =>
          mode === "hashtag"
            ? hit.entityType === "tag"
            : hit.entityType !== "tag",
        ),
      ),
    [mode, search],
  );

  const results = useDebouncedSearch({
    query: activeQuery ?? "",
    search: searchForMode,
    enabled: activeQuery !== null && !suppressed,
  });

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
    // The caret lands inside the token just inserted, which the detectors read
    // as a fragment to complete — so without this the picker would re-offer the
    // completion the user just took. Typing clears it.
    setSuppressed(true);
    // The value updates on re-render; restore the caret after the DOM catches up.
    requestAnimationFrame(() => {
      const el = fieldRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  }

  const { activeIndex, listboxId, optionId, onKeyDown } = useTypeahead({
    query: activeQuery ?? "",
    results,
    onSelect: pick,
    // Escape dismisses the picker for this fragment and swallows the key so it
    // reaches nothing else — but only when there is a picker to dismiss.
    onEscape: (event) => {
      if (results.length === 0) return;
      event.preventDefault();
      setSuppressed(true);
    },
  });

  function onFieldChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    onChange(e.target.value);
    setCaret(e.target.selectionStart);
    setSuppressed(false); // typing re-opens the picker
  }

  // Keep the fragment in step with caret-only moves (arrow keys, clicks).
  function onFieldSelect(
    e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    setCaret(e.currentTarget.selectionStart);
  }

  return (
    <Combobox
      containerTag="span"
      results={results}
      activeIndex={activeIndex}
      listboxId={listboxId}
      optionId={optionId}
      getKey={(hit) => `${hit.entityType}:${hit.entityId}`}
      onSelect={pick}
      renderOption={(hit) => {
        const reasons = hit.reasons.filter((r) => r.facet !== "name");
        return (
          <>
            {/* Tag hits show the "#" sigil; it sits outside the highlighted
                span since it's never part of the match (mirrors SearchBar). */}
            {hit.entityType === "tag" && "#"}
            {highlightMatch(hit.title, activeQuery ?? "")}
            {reasons.length > 0 && (
              <ComboboxOptionDetail>
                matched on{" "}
                {reasons.map((r, ri) => (
                  <Fragment key={`${r.facet}:${r.matchedText}`}>
                    {ri > 0 && ", "}
                    {r.facet === "tag" && "#"}
                    {r.matchedText}
                  </Fragment>
                ))}
              </ComboboxOptionDetail>
            )}
          </>
        );
      }}
      renderField={(aria) => {
        const shared = {
          ref: fieldRef,
          name,
          value,
          placeholder,
          onChange: onFieldChange,
          onSelect: onFieldSelect,
          onKeyDown,
          ...aria,
        };
        return multiline ? (
          <textarea {...shared} rows={rows} />
        ) : (
          <input {...shared} type="text" />
        );
      }}
    />
  );
}
