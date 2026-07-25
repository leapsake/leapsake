// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { highlightBirthday, highlightMatch } from "../src/web/index.js";

// Vitest runs without globals, so Testing Library can't register its own
// auto-cleanup — without this, earlier renders stay in the document.
afterEach(cleanup);

/** The marked runs, in order — what a reader actually sees emphasised. */
function marks(node: ReactNode): string[] {
  const { container } = render(<>{node}</>);
  return [...container.querySelectorAll("mark")].map(
    (m) => m.textContent ?? "",
  );
}

describe("highlightMatch", () => {
  it("marks the matched run and leaves the rest plain", () => {
    const { container } = render(<>{highlightMatch("Josephine", "sep")}</>);
    expect(container.textContent).toBe("Josephine");
    expect(marks(highlightMatch("Josephine", "sep"))).toEqual(["sep"]);
  });

  it("marks nothing when the term does not match", () => {
    expect(marks(highlightMatch("Josephine", "zz"))).toEqual([]);
  });

  it("folds accents and case the way the search service does", () => {
    expect(marks(highlightMatch("Renée", "renee"))).toEqual(["Renée"]);
  });

  it("folds a phone number to digits so punctuation doesn't break the match", () => {
    expect(marks(highlightMatch("(555) 867-5309", "8675", "phone"))).toEqual([
      "867-5",
    ]);
  });
});

describe("highlightBirthday", () => {
  it("marks the month a name query names", () => {
    expect(marks(highlightBirthday("October 31, 1990", "october"))).toEqual([
      "October",
    ]);
  });
});
