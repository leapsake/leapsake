import type { SearchHit } from "@leapsake/schema";
import { useDebouncedSearch, useTypeahead } from "@leapsake/ui/headless";
import {
  Combobox,
  ComboboxOptionDetail,
  highlightBirthday,
  highlightMatch,
} from "@leapsake/ui/web";
import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";

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
 * Module-level so its identity is stable across renders, which is what
 * `useDebouncedSearch` needs to avoid re-running its effect every render.
 */
const searchEntities = (query: string) => window.api.search.query(query);

/**
 * Persistent global search, mounted in the app chrome. A WAI-ARIA combobox: the
 * input keeps focus while arrow keys move `aria-activedescendant` over the
 * results listbox, Enter navigates to the active entity, Escape clears. ⌘K (or
 * Ctrl+K) focuses the input from anywhere.
 *
 * The combobox mechanics live in `@leapsake/ui`; what stays here is what makes
 * this bar itself — where a hit navigates to, the ⌘K shortcut, and how a hit's
 * match reasons are rendered.
 */
export function SearchBar() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");

  const results = useDebouncedSearch({ query: term, search: searchEntities });

  function go(hit: SearchHit) {
    setTerm("");
    inputRef.current?.blur(); // drop focus so the result screen takes over
    navigate(pathFor(hit));
  }

  const { open, activeIndex, listboxId, optionId, onKeyDown } = useTypeahead({
    query: term,
    results,
    onSelect: go,
    // Escape empties the bar, which also collapses the listbox — this one is
    // always live, so there is nothing else to dismiss.
    onEscape: () => setTerm(""),
  });

  // ⌘K / Ctrl+K focuses (and selects) the input from anywhere in the app.
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onGlobalKeyDown);
    return () => document.removeEventListener("keydown", onGlobalKeyDown);
  }, []);

  return (
    <Combobox
      results={results}
      activeIndex={activeIndex}
      listboxId={listboxId}
      optionId={optionId}
      getKey={(hit) => `${hit.entityType}:${hit.entityId}`}
      onSelect={go}
      announcement={open ? `${results.length} results` : ""}
      renderOption={(hit) => {
        const reasons = hit.reasons.filter((r) => r.facet !== "name");
        return (
          <>
            {/* Tag results render with the "#" sigil; the sigil sits outside
                the highlighted span since it's never part of the match. */}
            {hit.entityType === "tag" && "#"}
            {highlightMatch(hit.title, term)}
            {reasons.length > 0 && (
              <ComboboxOptionDetail>
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
              </ComboboxOptionDetail>
            )}
          </>
        );
      }}
      renderField={(aria) => (
        <input
          ref={inputRef}
          type="text"
          aria-label="Search people, pets, tags, holidays, and gift ideas"
          placeholder="Search… (⌘K)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKeyDown}
          {...aria}
        />
      )}
    />
  );
}
