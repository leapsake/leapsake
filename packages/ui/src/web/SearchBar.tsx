import type { SearchHit } from "@leapsake/schema";
import { Fragment, useEffect, useRef, useState } from "react";
import { searchHitPath } from "../headless/routes.js";
import { useDebouncedSearch } from "../headless/useDebouncedSearch.js";
import { useTypeahead } from "../headless/useTypeahead.js";
import { useMessages } from "../messages/index.js";
import { highlightBirthday, highlightMatch } from "./highlight.js";
import { Combobox, ComboboxOptionDetail } from "./primitives/Combobox.js";

/** Global search in the app chrome; ⌘K or Ctrl+K focuses it from anywhere. */
export function SearchBar({
  search,
  onNavigate,
}: {
  /** Must be stable, as `useDebouncedSearch` holds it as a dependency. */
  search: (query: string) => Promise<SearchHit[]>;
  onNavigate: (href: string) => void;
}) {
  const m = useMessages();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");

  const results = useDebouncedSearch({ query: term, search });

  function go(hit: SearchHit) {
    setTerm("");
    inputRef.current?.blur(); // drop focus so the result screen takes over
    onNavigate(searchHitPath(hit));
  }

  const { open, activeIndex, listboxId, optionId, onKeyDown } = useTypeahead({
    query: term,
    results,
    onSelect: go,
    // Escape empties the bar, which also collapses the listbox.
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
      announcement={open ? m.combobox.resultCount(results.length) : ""}
      renderOption={(hit) => {
        const reasons = hit.reasons.filter((r) => r.facet !== "name");
        return (
          <>
            {/* The “#” sits outside the highlight: it is never matched. */}
            {hit.entityType === "tag" && "#"}
            {highlightMatch(hit.title, term)}
            {reasons.length > 0 && (
              <ComboboxOptionDetail>
                {m.search.matchedOn}{" "}
                {reasons.map((r, ri) => (
                  <Fragment key={`${r.facet}:${r.matchedText}`}>
                    {ri > 0 && m.search.reasonSeparator}
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
          aria-label={m.search.fieldLabel}
          placeholder={m.search.placeholder}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKeyDown}
          {...aria}
        />
      )}
    />
  );
}
