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
} from "@leapsake/schema";
import { useCallback, useRef, useState } from "react";
import { useDebouncedSearch } from "./useDebouncedSearch.js";

type Selection = { start: number; end: number };

/**
 * The state behind a `ChipTextField` on either platform: the draft and its chips,
 * which `@mention` or tag the caret is in, and the picker's results for it. Each
 * platform's field keeps only its own text-input handling — placing the caret,
 * keys, focus — and its markup.
 *
 * Two grammars, for the two places tags are typed:
 *
 * - **`"prose"`** — a reminder's title/body. `value`/`onChange` carry the
 *   *stored* text, mention tokens and all (`@[Violet Bick](person:<uuid>)`),
 *   while the field shows `@Violet Bick`. Only `#`-prefixed runs are tags.
 * - **`"tags"`** — a Person/Pet/GiftIdea Tags field, where the text *is* the
 *   stored value and every word is a tag (see `parseTagNames`), so every word
 *   chips.
 *
 * The draft ({@link ComposerDraft}) is **state**, not something re-derived from
 * `value` each render, because a chip is partly invisible in the text: a `#family`
 * still being typed and one already committed read identically, and only the
 * second is a chip. It is re-seeded whenever `value` stops matching what the draft
 * serialises to, which is what a parent resetting the field looks like from here.
 *
 * Which trigger the caret sits in decides three things: which detector runs
 * ({@link activeMentionQuery} vs {@link activeTagQuery}), which hits are kept
 * (people/pets vs `tag`), and which insert helper splices the choice in.
 */
export function useChipDraft({
  grammar,
  value,
  onChange,
  search,
  placeCaret,
}: {
  grammar: "prose" | "tags";
  value: string;
  onChange: (value: string) => void;
  /** Must be stable — `useDebouncedSearch` takes it as an effect dependency. */
  search: (query: string) => Promise<SearchHit[]>;
  /**
   * Move the field's own caret. Called only when that caret is now wrong — a
   * pick, or an edit that took a whole chip; doing it on every keystroke is what
   * breaks IME composition.
   */
  placeCaret: (caret: number) => void;
}) {
  const prose = grammar === "prose";

  // The caret offset drives fragment detection; `null` until the field is
  // touched, so a fresh field with pre-filled text doesn't spuriously open.
  const [caret, setCaret] = useState<number | null>(null);
  // Where the caret was before the move being handled — the direction an arrow
  // key was travelling, which is what carries it over a chip rather than into it.
  const previousCaret = useRef<number | null>(null);
  // A dismiss or a completed pick suppresses the picker until the user types.
  const [suppressed, setSuppressed] = useState(false);

  const seed = (text: string): ComposerDraft =>
    prose ? draftFromMarkup(text) : draftFromTagField(text);
  const serialize = (next: ComposerDraft) =>
    prose ? markupFromDraft(next) : next.text;

  const [draft, setDraft] = useState(() => seed(value));
  // Everything the field itself does goes through `commit`, which keeps the two
  // in step, so a mismatch means the value changed under us: re-seed from it.
  const live = serialize(draft) === value ? draft : seed(value);

  function commit(next: ComposerDraft, nextCaret: number, force: boolean) {
    setDraft(next);
    onChange(serialize(next));
    setCaret(nextCaret);
    previousCaret.current = nextCaret;
    if (force) placeCaret(nextCaret);
  }

  // A mention fragment spans spaces, so it can overlap a later tag; when both
  // match, the trigger nearest the caret (greater `start`) is the live one.
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

  // The tag picker keeps only tag hits; the `@mention` picker excludes them.
  // Memoised on `mode`, because `useDebouncedSearch` re-runs on a new identity.
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

  return {
    /** The draft the field shows: its text, and which runs of it are chips. */
    live,
    /** What the caret's `@mention` or tag says so far, or `null` outside one. */
    activeQuery,
    results,
    /** The field's displayed text changed: chips move, grow or go whole with it. */
    edit(text: string) {
      const edited = applyDraftEdit(live, text);
      commit(edited.draft, edited.caret, edited.tookChip);
      setSuppressed(false);
    },
    /** Splice the chosen hit in as a chip, the caret at its end. */
    pick(hit: SearchHit) {
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
      setSuppressed(true);
    },
    /** Where `selection` belongs so it neither enters nor splits a chip. */
    snap(selection: Selection): Selection {
      return snapSelection(live.spans, selection, previousCaret.current);
    },
    /** The caret moved without an edit (arrows, a click, a snap). */
    moveCaret(next: number) {
      previousCaret.current = next;
      setCaret(next);
    },
    /** Close the picker until the next edit. */
    suppress() {
      setSuppressed(true);
    },
  };
}
