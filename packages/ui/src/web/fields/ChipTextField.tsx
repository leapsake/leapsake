import {
  type ComposerDraft,
  type SearchHit,
  splitDraft,
} from "@leapsake/schema";
import { useChipDraft } from "../../headless/useChipDraft.js";
import { useTypeahead } from "../../headless/useTypeahead.js";
import { Fragment, useLayoutEffect, useRef } from "react";
import { useMessages } from "../../messages/index.js";
import { highlightMatch } from "../highlight.js";
import { Combobox, ComboboxOptionDetail } from "../primitives/Combobox.js";
import styles from "./ChipTextField.module.css";

/** The DOM half of {@link useChipDraft}: mentions and tags as chips. */
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
  /** Finds people, pets and tags; must be stable, as an effect uses it. */
  search: (query: string) => Promise<SearchHit[]>;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const m = useMessages();
  const prose = grammar === "prose";
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLSpanElement>(null);

  const chips = useChipDraft({
    grammar,
    value,
    onChange,
    search,
    // The value updates on re-render; place the caret once the DOM catches up.
    placeCaret: (caret) =>
      requestAnimationFrame(() =>
        fieldRef.current?.setSelectionRange(caret, caret),
      ),
  });
  const { live, activeQuery, results } = chips;

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

  function pick(hit: SearchHit) {
    chips.pick(hit);
    fieldRef.current?.focus();
  }

  const { activeIndex, listboxId, optionId, onKeyDown, selectActive } =
    useTypeahead({
      query: activeQuery ?? "",
      results,
      onSelect: pick,
      // Escape dismisses an open picker for this fragment and swallows the key.
      onEscape: (event) => {
        if (results.length === 0) return;
        event.preventDefault();
        chips.suppress();
      },
    });

  /** Tab picks like Enter, else moves focus; Shift+Tab always leaves. */
  function onFieldKeyDown(
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (event.key === "Tab" && !event.shiftKey && selectActive()) {
      event.preventDefault();
      return;
    }
    onKeyDown(event);
  }

  function onFieldChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    chips.edit(e.target.value);
  }

  /** Keeps the caret out of chips, and the fragment in step with it. */
  function onFieldSelect(
    e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const el = e.currentTarget;
    const selection = {
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0,
    };
    const snapped = chips.snap(selection);
    if (snapped.start !== selection.start || snapped.end !== selection.end) {
      el.setSelectionRange(snapped.start, snapped.end);
    }
    chips.moveCaret(snapped.end);
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
                {m.search.matchedOn}{" "}
                {reasons.map((r, ri) => (
                  <Fragment key={`${r.facet}:${r.matchedText}`}>
                    {ri > 0 && m.search.reasonSeparator}
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
          onKeyDown: onFieldKeyDown,
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

// Runs go in `data-run`, not text, to stay out of the enclosing label's name.
// A trailing newline gains a space so the mirror's height matches the field's.
function mirrorRuns(draft: ComposerDraft): { text: string; chip: boolean }[] {
  const runs = splitDraft(draft).map((run) => ({
    text: run.text,
    chip: run.kind !== "text",
  }));
  const last = runs.at(-1);
  if (last && last.text.endsWith("\n")) last.text += " ";
  return runs;
}
