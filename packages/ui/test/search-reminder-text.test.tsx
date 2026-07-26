// @vitest-environment jsdom
import type { ResolvedMention, SearchHit, Tag } from "@leapsake/schema";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchHitPath } from "../src/headless/index.js";
import { ReminderText, SearchBar } from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

const hit = (over: Partial<SearchHit> = {}): SearchHit =>
  ({
    entityType: "person",
    entityId: "p-1",
    title: "Ada Lovelace",
    reasons: [],
    ...over,
  }) as SearchHit;

const field = () => screen.getByRole("combobox");
const type = (value: string) =>
  fireEvent.change(field(), { target: { value } });
/** Past the 200ms debounce, with the search promise settled. */
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 250));
  });
};

describe("searchHitPath", () => {
  it("sends each result to the page that can act on it", () => {
    expect(searchHitPath(hit({ entityType: "person", entityId: "p-1" }))).toBe(
      "/people/p-1",
    );
    expect(searchHitPath(hit({ entityType: "pet", entityId: "x-1" }))).toBe(
      "/pets/x-1",
    );
    expect(searchHitPath(hit({ entityType: "tag", entityId: "t-1" }))).toBe(
      "/tags/t-1",
    );
    expect(searchHitPath(hit({ entityType: "holiday", entityId: "h-1" }))).toBe(
      "/holidays/h-1",
    );
    // A gift idea has no read-only view, so its actionable page is the editor.
    expect(
      searchHitPath(hit({ entityType: "gift_idea", entityId: "i-1" })),
    ).toBe("/gifts/i-1/edit");
  });
});

describe("SearchBar", () => {
  it("stays quiet below the two-character floor", async () => {
    const search = vi.fn(async () => [hit()]);
    renderWithUi(<SearchBar search={search} onNavigate={vi.fn()} />);

    type("a");
    await settle();
    expect(search).not.toHaveBeenCalled();
  });

  it("navigates to the picked result and clears itself", async () => {
    const onNavigate = vi.fn();
    renderWithUi(
      <SearchBar search={async () => [hit()]} onNavigate={onNavigate} />,
    );

    type("ada");
    await settle();
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /Ada Lovelace/ }));
    });

    expect(onNavigate).toHaveBeenCalledWith("/people/p-1");
    expect(field()).toHaveProperty("value", "");
  });

  it("says why a result matched when it wasn't the name", async () => {
    renderWithUi(
      <SearchBar
        search={async () => [
          hit({ reasons: [{ facet: "tag", matchedText: "friend" }] as never }),
        ]}
        onNavigate={vi.fn()}
      />,
    );

    type("fri");
    await settle();
    expect(screen.getByRole("option").textContent).toContain("matched on");
  });

  it("clears on Escape", async () => {
    renderWithUi(
      <SearchBar search={async () => [hit()]} onNavigate={vi.fn()} />,
    );

    type("ada");
    await settle();
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field()).toHaveProperty("value", "");
  });
});

const tags = [{ id: "t-1", name: "family", normalized: "family" }] as Tag[];

/** The mention token only matches a real UUID — see `splitAnnotatedText`. */
const PERSON_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("ReminderText", () => {
  it("links an inline #tag to its tag page", () => {
    renderWithUi(
      <ReminderText
        text="ask about the trip #family"
        tags={tags}
        mentions={[]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "#family" }).getAttribute("href"),
    ).toBe("/tags/t-1");
  });

  it("links a mention to whoever it names, using their current label", () => {
    // The stored token carries a snapshot name; a rename shows through because
    // the resolved mention supplies the live one.
    const mentions = [
      {
        targetType: "person",
        targetId: PERSON_ID,
        label: "Ada Byron",
      },
    ] as ResolvedMention[];

    renderWithUi(
      <ReminderText
        text={`call @[Ada Lovelace](person:${PERSON_ID})`}
        tags={[]}
        mentions={mentions}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Ada Byron" }).getAttribute("href"),
    ).toBe(`/people/${PERSON_ID}`);
  });

  it("falls back to the snapshot name when the target is gone", () => {
    const mentions = [
      { targetType: "person", targetId: PERSON_ID, label: null },
    ] as ResolvedMention[];

    renderWithUi(
      <ReminderText
        text={`call @[Ada Lovelace](person:${PERSON_ID})`}
        tags={[]}
        mentions={mentions}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
  });

  it("leaves an unmatched #tag as plain text", () => {
    const { container } = renderWithUi(
      <ReminderText text="a #nope tag" tags={[]} mentions={[]} />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("a #nope tag");
  });
});
