import {
  type EntityType,
  type MentionDraft,
  type SearchHit,
  activeHashtagQuery,
  activeMentionQuery,
  applyDraftEdit,
  draftFromMarkup,
  insertHashtag,
  insertMentionInDraft,
  markupFromDraft,
  splitDraft,
} from "@leapsake/schema";
import { useDebouncedSearch } from "../../headless/useDebouncedSearch.js";
import { useTypeahead } from "../../headless/useTypeahead.js";
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { highlightMatch } from "../highlight.js";
import { Combobox, ComboboxOptionDetail } from "../primitives/Combobox.js";
import styles from "./MentionTextField.module.css";

/**
 * A controlled text field (single-line `input` or `multiline` `textarea`) with a
 * shared `@mention` / `#tag` authoring typeahead. Typing `@` then a name opens a
 * People/Pets picker; typing `#` then a word opens an existing-tags picker. Both
 * run off the same search + caret machinery — only three things branch on which
 * trigger the caret sits in: which detector runs ({@link activeMentionQuery} vs
 * {@link activeHashtagQuery}), which hits are kept (people/pets vs `tag`), and
 * which insert helper splices the chosen token in ({@link insertMentionInDraft}
 * vs {@link insertHashtag}).
 *
 * `value` and `onChange` carry the **stored** text, mention tokens and all
 * (`@[Alice Ng](person:<uuid>)`) — the write path still re-derives mentions and
 * taggings from it, so a brand-new `#tag` with no suggestion is created on save
 * and the picker only ever offers completions. But nobody wants to *type* around
 * a uuid, so what the field shows is that text's {@link draftFromMarkup} draft —
 * `@Alice Ng`, with the id held beside the text as a span. Every edit is
 * reconciled back through {@link applyDraftEdit} → {@link markupFromDraft}, so
 * the markup stays the single source of truth and there is no second copy to
 * drift. A `#tag` needs none of this: it reads as typed.
 *
 * The mention is *shown* as a mention by a backdrop layer under the field
 * painting a tint behind each `@Name` (see the stylesheet, which explains why the
 * field cannot simply style itself). Clicking through to the person is the saved
 * `ReminderText`'s job, not the composer's.
 *
 * Controlled, but the markup rides on a hidden input carrying `name` — so the
 * write path keeps reading it from `FormData` unchanged while the visible field
 * shows the draft. The listbox, keyboard handling and debounce come from
 * `@leapsake/ui`; what stays here is the caret work — finding the fragment under
 * the cursor and splicing the chosen name back in.
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
  const backdropRef = useRef<HTMLSpanElement>(null);

  // The caret offset drives fragment detection; `null` until the field is
  // touched, so a fresh field with pre-filled text doesn't spuriously open.
  const [caret, setCaret] = useState<number | null>(null);
  // Escape — and a completed pick — suppress the picker until the user types.
  const [suppressed, setSuppressed] = useState(false);

  // What the user sees and what their caret offsets are measured against.
  const draft = draftFromMarkup(value);

  // Which inline trigger — `@mention` or `#hashtag` — the caret sits in. A
  // mention fragment spans spaces, so it can overlap a later `#`; when both
  // detectors match, the one whose trigger is nearest the caret (greater `start`)
  // is the live one — i.e. the token the user is currently typing.
  const mention =
    caret === null ? null : activeMentionQuery(draft.text, caret, draft.spans);
  const hashtag =
    caret === null ? null : activeHashtagQuery(draft.text, caret, draft.spans);
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

  /** Keep the backdrop's chips under the text as the field scrolls. */
  function syncScroll() {
    const field = fieldRef.current;
    const backdrop = backdropRef.current;
    if (!field || !backdrop) return;
    backdrop.scrollTop = field.scrollTop;
    backdrop.scrollLeft = field.scrollLeft;
  }

  // Typing can scroll the field without a `scroll` event of its own (the caret
  // dragging the viewport along), so re-sync after every render too.
  useLayoutEffect(syncScroll);

  /** Splice the chosen hit in, then restore focus + caret past it. */
  function pick(hit: SearchHit) {
    if (caret === null) return;
    // A tag hit inserts the bare `#name` — plain text, so its effect on the
    // mention spans is just an edit like any other. A person/pet hit inserts
    // `@Name` and the span that remembers which entity it is.
    let nextCaret: number;
    if (mode === "hashtag") {
      const inserted = insertHashtag(draft.text, caret, hit.title, draft.spans);
      nextCaret = inserted.caret;
      onChange(markupFromDraft(applyDraftEdit(draft, inserted.text)));
    } else {
      const inserted = insertMentionInDraft(draft, caret, {
        displayName: hit.title,
        targetType: hit.entityType as EntityType, // never "tag" here
        targetId: hit.entityId,
      });
      nextCaret = inserted.caret;
      onChange(markupFromDraft(inserted.draft));
    }
    // For a tag, the caret lands inside the token just inserted, which the
    // detector reads as a fragment to complete — so without this the picker
    // would re-offer the completion the user just took. Typing clears it.
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
    // The field hands back displayed text; the spans move (or decay) with it.
    onChange(markupFromDraft(applyDraftEdit(draft, e.target.value)));
    setCaret(e.target.selectionStart);
    setSuppressed(false); // typing re-opens the picker
  }

  // Keep the fragment in step with caret-only moves (arrow keys, clicks).
  function onFieldSelect(
    e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    setCaret(e.currentTarget.selectionStart);
  }

  const wrapMode = multiline ? styles.multiline : styles.singleLine;

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
          className: `${styles.field} ${wrapMode}`,
          value: draft.text,
          placeholder,
          onChange: onFieldChange,
          onSelect: onFieldSelect,
          onScroll: syncScroll,
          onKeyDown,
          ...aria,
        };
        return (
          <span className={styles.wrap}>
            {/* Under the field, in lockstep with it: the same text, drawn
                invisibly, with a tint behind each mention. */}
            <span
              ref={backdropRef}
              aria-hidden="true"
              className={`${styles.backdrop} ${wrapMode}`}
            >
              {mirrorRuns(draft).map((run, i) => (
                <span
                  key={i}
                  className={run.mention ? styles.mention : undefined}
                  data-run={run.text}
                />
              ))}
            </span>
            {multiline ? (
              <textarea {...shared} rows={rows} />
            ) : (
              <input {...shared} type="text" />
            )}
            {/* The stored text, tokens and all — what the write path reads. */}
            <input type="hidden" name={name} value={value} />
          </span>
        );
      }}
    />
  );
}

/**
 * The runs the backdrop paints, as `data-run` attributes rather than text: the
 * stylesheet puts each one back with `content: attr(data-run)`. Generated content
 * is invisible to `textContent`, which matters because this field sits *inside*
 * its `<label>` — a mirrored copy of the text as real nodes would land in the
 * label's accessible name (and in anything else that reads the label's text).
 *
 * A trailing newline gets a space so the mirror renders the same final empty line
 * the field does; without it the two heights differ by a line and the scroll sync
 * drifts.
 */
function mirrorRuns(draft: MentionDraft): { text: string; mention: boolean }[] {
  const runs = splitDraft(draft).map((segment) => ({
    text: segment.text,
    mention: segment.mention !== null,
  }));
  const last = runs.at(-1);
  if (last && last.text.endsWith("\n")) last.text += " ";
  return runs;
}
