// @vitest-environment jsdom
import { type SearchHit, mentionToken } from "@leapsake/schema";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChipDraft } from "../src/headless/index.js";

afterEach(cleanup);

const VIOLET = "0b8e8a52-6f7e-4d0f-9d8e-2f6d7c1b3a90";
const violetToken = mentionToken("Violet Bick", "person", VIOLET);

const hit = (entityType: string, entityId: string, title: string) =>
  ({ entityType, entityId, title, reasons: [] }) as unknown as SearchHit;
const violetHit = hit("person", VIOLET, "Violet Bick");
const familyHit = hit("tag", "t-1", "family");
const search = vi.fn(async () => [violetHit, familyHit]);

type Host = ReturnType<typeof host>;

/** The hook as a field uses it: the parent owning the stored value. */
function host(initial: string, grammar: "prose" | "tags" = "prose") {
  const placeCaret = vi.fn();
  const view = renderHook(() => {
    const [value, setValue] = useState(initial);
    const chips = useChipDraft({
      grammar,
      value,
      onChange: setValue,
      search,
      placeCaret,
    });
    return { value, setValue, chips };
  });
  return { ...view, placeCaret };
}

/** Type `text`, leaving the caret at its end, as each platform reports it. */
function type(result: Host["result"], text: string) {
  act(() => result.current.chips.edit(text));
  act(() => result.current.chips.moveCaret(text.length));
}

describe("useChipDraft", () => {
  it("shows a prose value's mentions as names, keeping the stored tokens", () => {
    const { result } = host(`call ${violetToken} #family`);

    expect(result.current.chips.live.text).toBe("call @Violet Bick #family");
    expect(result.current.value).toBe(`call ${violetToken} #family`);
    // Untouched, nothing is being typed, so nothing is searched for.
    expect(result.current.chips.activeQuery).toBeNull();
  });

  it("re-seeds when the value changes under it", () => {
    const { result } = host("call Violet");

    act(() => result.current.setValue(`see ${violetToken}`));

    expect(result.current.chips.live.text).toBe("see @Violet Bick");
    expect(result.current.chips.live.spans).toHaveLength(1);
  });

  it("offers people for an @mention and tags for a #tag", async () => {
    const { result } = host("");

    type(result, "call @vio");
    expect(result.current.chips.activeQuery).toBe("vio");
    await waitFor(() =>
      expect(result.current.chips.results).toEqual([violetHit]),
    );

    type(result, "call @vio #fam");
    expect(result.current.chips.activeQuery).toBe("fam");
    await waitFor(() =>
      expect(result.current.chips.results).toEqual([familyHit]),
    );
  });

  it("treats every word as a tag in a tags field, and never a mention", async () => {
    const { result } = host("", "tags");

    type(result, "@fam");
    await waitFor(() =>
      expect(result.current.chips.results).toEqual([familyHit]),
    );
  });

  it("stores a picked mention as its token and places the caret at its end", async () => {
    const { result, placeCaret } = host("");
    type(result, "call @vio");
    await waitFor(() => expect(result.current.chips.results).not.toEqual([]));

    act(() => result.current.chips.pick(violetHit));

    expect(result.current.value).toBe(`call ${violetToken} `);
    expect(result.current.chips.live.text).toBe("call @Violet Bick ");
    expect(placeCaret).toHaveBeenCalledWith("call @Violet Bick".length);
  });

  it("keeps the picker shut after a pick, and after a dismiss, until the next edit", async () => {
    const { result } = host("", "tags");
    type(result, "fam");
    await waitFor(() => expect(result.current.chips.results).not.toEqual([]));

    act(() => result.current.chips.suppress());
    expect(result.current.chips.results).toEqual([]);

    type(result, "fami");
    await waitFor(() => expect(result.current.chips.results).not.toEqual([]));
  });

  it("moves the field's caret only when an edit takes a whole chip", () => {
    const { result, placeCaret } = host(`hi ${violetToken}`);

    type(result, "hi @Violet Bic");
    expect(result.current.value).toBe("hi ");
    expect(placeCaret).toHaveBeenCalledWith(3);

    placeCaret.mockClear();
    type(result, "hi there");
    expect(placeCaret).not.toHaveBeenCalled();
  });

  it("snaps a caret inside a chip the way it was travelling", () => {
    const { result } = host(`hi ${violetToken} ok`);
    // "hi @Violet Bick ok": the chip spans 3–15.

    act(() => result.current.chips.moveCaret(15));
    expect(result.current.chips.snap({ start: 14, end: 14 })).toEqual({
      start: 3,
      end: 3,
    });

    act(() => result.current.chips.moveCaret(3));
    expect(result.current.chips.snap({ start: 4, end: 4 })).toEqual({
      start: 15,
      end: 15,
    });
    expect(result.current.chips.snap({ start: 1, end: 5 })).toEqual({
      start: 1,
      end: 15,
    });
  });
});
