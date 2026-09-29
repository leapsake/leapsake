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

/** The state behind a `ChipTextField` on either platform. */
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
  /** Moves the field's caret, only when wrong: every keystroke breaks IME. */
  placeCaret: (caret: number) => void;
}) {
  const prose = grammar === "prose";

  // `null` until touched, so a pre-filled field doesn't open its picker.
  const [caret, setCaret] = useState<number | null>(null);
  // The caret before this move; its direction steps it over a chip.
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
  // What an event sees before the next render: iOS reports the caret an edit
  // moved before React re-renders with the edit's chips.
  const latest = useRef(live);
  latest.current = live;

  function commit(next: ComposerDraft, nextCaret: number, force: boolean) {
    latest.current = next;
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
    /** The caret's `@mention` or tag so far, or `null` outside one. */
    activeQuery,
    results,
    /** The displayed text changed: chips move, grow or go whole with it. */
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
      return snapSelection(
        latest.current.spans,
        selection,
        previousCaret.current,
      );
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
