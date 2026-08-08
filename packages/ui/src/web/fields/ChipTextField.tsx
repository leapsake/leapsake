import {
  type ComposerDraft,
  type EntityType,
  type SearchHit,
  activeMentionQuery,
  activeTagQuery,
  applyDraftEdit,
  draftFromMarkup,
  draftFromTagField,
  insertMentionInDraft,
  insertTagInDraft,
  markupFromDraft,
  snapSelection,
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
import styles from "./ChipTextField.module.css";

/**
 * A controlled text field whose `@mentions` and `#tags` read as **chips** — a
 * tinted run that behaves as one thing — with a typeahead for both. Typing `@`
 * then a name opens a People/Pets picker; typing a tag opens an existing-tags
 * picker. Which trigger the caret sits in decides three things and no others:
 * which detector runs ({@link activeMentionQuery} vs {@link activeTagQuery}),
 * which hits are kept (people/pets vs `tag`), and which insert helper splices the
 * choice in ({@link insertMentionInDraft} vs {@link insertTagInDraft}).
 *
 * Two grammars, for the two places tags are typed:
 *
 * - **`"prose"`** — a reminder's title/body. `value`/`onChange` carry the
 *   *stored* text, mention tokens and all (`@[Alice Ng](person:<uuid>)`), which
 *   the write path re-derives mentions and taggings from; the hidden input
 *   carries it to `FormData` while the visible field shows `@Alice Ng`. Only
 *   `#`-prefixed runs are tags, so ordinary words stay ordinary.
 * - **`"tags"`** — a Person/Pet/GiftIdea Tags field. The visible text *is* the
 *   stored value, so the field keeps its own `name` and there is no hidden input.
 *   Every word is a tag (see `parseTagNames`), so every word chips — which is the
 *   point: the chips can't then lie about what saving does.
 *
 * The draft ({@link ComposerDraft}) is **state**, not something re-derived from
 * `value` each render, because a chip is partly invisible in the text: a `#family`
 * still being typed and one already committed read identically, and only the
 * second is a chip. It is re-seeded whenever `value` stops matching what the draft
 * serialises to, which is what a parent resetting the field looks like from here.
 *
 * Chips are atomic. The caret rests at a chip's edges but never inside it, and an
 * edit reaching into one takes the whole chip — both rules live in
 * `@leapsake/schema` ({@link snapSelection}, {@link applyDraftEdit}) so the two
 * clients cannot drift. Clicking through to a person or a tag page is the saved
 * `ReminderText`'s job, not the composer's.
 */
export function ChipTextField({
  name,
  grammar = "prose",
  value,
  onChange,
  search,
  multiline,
  rows,
  placeholder,
}: {
  name: string;
  /** Which text this field holds, and therefore how it spells its tags. */
  grammar?: "prose" | "tags";
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
  const prose = grammar === "prose";
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLSpanElement>(null);

  // The caret offset drives fragment detection; `null` until the field is
  // touched, so a fresh field with pre-filled text doesn't spuriously open.
  const [caret, setCaret] = useState<number | null>(null);
  // Where the caret was before the move being handled — the direction an arrow
  // key was travelling, which is what carries it over a chip rather than into it.
  const previousCaret = useRef<number | null>(null);
  // Escape — and a completed pick — suppress the picker until the user types.
  const [suppressed, setSuppressed] = useState(false);

  const seed = useCallback(
    (text: string): ComposerDraft =>
      prose ? draftFromMarkup(text) : draftFromTagField(text),
    [prose],
  );
  const serialize = useCallback(
    (next: ComposerDraft) => (prose ? markupFromDraft(next) : next.text),
    [prose],
  );

  const [draft, setDraft] = useState(() => seed(value));
  // The value changed under us (a reset, a different record): re-seed from it.
  // Everything the field itself does goes through `commit`, which keeps the two
  // in step, so this only fires for changes that didn't come from here.
  const current = serialize(draft);
  const live = current === value ? draft : seed(value);

  /**
   * Push an edited draft out as stored text, and put the caret where the edit
   * says it belongs. `force` only when the field's own caret is now wrong — a
   * pick, or an edit that took a whole chip; forcing it on every keystroke is
   * what breaks IME composition.
   */
  function commit(next: ComposerDraft, nextCaret: number, force: boolean) {
    setDraft(next);
    onChange(serialize(next));
    setCaret(nextCaret);
    previousCaret.current = nextCaret;
    if (!force) return;
    // The value updates on re-render; place the caret once the DOM catches up.
    requestAnimationFrame(() => {
      const el = fieldRef.current;
      if (!el) return;
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  // Which inline trigger — `@mention` or a tag — the caret sits in. A mention
  // fragment spans spaces, so it can overlap a later tag; when both detectors
  // match, the one whose trigger is nearest the caret (greater `start`) is the
  // live one — i.e. the token the user is currently typing.
  const mention =
    !prose || caret === null
      ? null
      : activeMentionQuery(live.text, caret, live.spans);
  const tag = caret === null ? null : activeTagQuery(live, caret);
  const mode: "mention" | "tag" | null =
    mention && tag
      ? tag.start > mention.start
        ? "tag"
        : "mention"
      : mention
        ? "mention"
        : tag
          ? "tag"
          : null;
  const active = mode === "tag" ? tag : mode === "mention" ? mention : null;
  const activeQuery = active?.query ?? null;

  // The tag picker keeps only tag hits; the `@mention` picker excludes them
  // (mentions only reference people/pets). Memoised on `mode`, because
  // `useDebouncedSearch` re-runs whenever this function's identity changes.
  const searchForMode = useCallback(
    (query: string) =>
      search(query).then((hits) =>
        hits.filter((hit) =>
          mode === "tag" ? hit.entityType === "tag" : hit.entityType !== "tag",
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

  /** Splice the chosen hit in as a set chip, then restore focus + caret past it. */
  function pick(hit: SearchHit) {
    if (caret === null) return;
    const inserted =
      mode === "tag"
        ? insertTagInDraft(live, caret, hit.title)
        : insertMentionInDraft(live, caret, {
            displayName: hit.title,
            targetType: hit.entityType as EntityType, // never "tag" here
            targetId: hit.entityId,
          });
    commit(inserted.draft, inserted.caret, true);
    // The caret lands at the chip's end, which is not a fragment — but a tag
    // picked in a tags field would re-open on the next keystroke otherwise.
    setSuppressed(true);
    fieldRef.current?.focus();
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
    // The field hands back displayed text; chips move, grow or go whole with it.
    const edited = applyDraftEdit(live, e.target.value);
    commit(edited.draft, edited.caret, edited.tookChip);
    setSuppressed(false); // typing re-opens the picker
  }

  /**
   * Keep the caret out of the chips, and the fragment in step with caret-only
   * moves (arrow keys, clicks, drags).
   */
  function onFieldSelect(
    e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const el = e.currentTarget;
    const selection = {
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0,
    };
    const snapped = snapSelection(live.spans, selection, previousCaret.current);
    if (snapped.start !== selection.start || snapped.end !== selection.end) {
      el.setSelectionRange(snapped.start, snapped.end);
    }
    // Where this move left the caret — what the *next* move is travelling from.
    previousCaret.current = snapped.end;
    setCaret(snapped.end);
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
          // A tags field's text is its stored value, so it carries `name`
          // itself; a prose field's doesn't — the hidden input below does.
          name: prose ? undefined : name,
          className: `${styles.field} ${wrapMode}`,
          value: live.text,
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
                invisibly, with a tint behind each chip. */}
            <span
              ref={backdropRef}
              aria-hidden="true"
              className={`${styles.backdrop} ${wrapMode}`}
            >
              {mirrorRuns(live).map((run, i) => (
                <span
                  key={i}
                  className={run.chip ? styles.chip : undefined}
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
            {prose && <input type="hidden" name={name} value={value} />}
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
function mirrorRuns(draft: ComposerDraft): { text: string; chip: boolean }[] {
  const runs = splitDraft(draft).map((run) => ({
    text: run.text,
    chip: run.kind !== "text",
  }));
  const last = runs.at(-1);
  if (last && last.text.endsWith("\n")) last.text += " ";
  return runs;
}
