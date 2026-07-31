// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GiftIdeaRecipientsSection,
  GiftsSection,
  type GivenRow,
  type IdeaSuggestionRow,
  type SuggestionRow,
} from "../src/web/index.js";
import { fakeGiftsPorts, renderWithGifts } from "./gift-support.js";

afterEach(cleanup);

const suggestion = (over: Partial<SuggestionRow> = {}): SuggestionRow => ({
  id: "s-1",
  giftIdeaId: "i-1",
  ideaTitle: "Kite",
  ideaUrl: null,
  occasionLabel: null,
  occasionType: null,
  occasionId: null,
  targetYear: null,
  targetMonth: null,
  targetDay: null,
  ...over,
});

const given = (over: Partial<GivenRow> = {}): GivenRow => ({
  id: "g-1",
  giftIdeaId: "i-2",
  ideaTitle: "Book",
  ideaUrl: null,
  giverLabel: null,
  occasionLabel: null,
  occasionType: null,
  occasionId: null,
  year: 2024,
  month: 12,
  day: 25,
  ...over,
});

function renderGifts({
  suggestions = [],
  gifts = [],
  ports = fakeGiftsPorts(),
}: {
  suggestions?: SuggestionRow[];
  gifts?: GivenRow[];
  ports?: ReturnType<typeof fakeGiftsPorts>;
} = {}) {
  const onChanged = vi.fn();
  renderWithGifts(
    <GiftsSection
      recipientType="person"
      recipientId="p-1"
      recipientLabel="Ada"
      suggestions={suggestions}
      gifts={gifts}
      ideaPool={[]}
      onChanged={onChanged}
    />,
    ports,
  );
  return { ports, onChanged };
}

/** The idea headings, in the order the section lists them. */
const ideaOrder = () =>
  screen.getAllByRole("link").map((a) => a.textContent ?? "");

/** An open adornments editor, probed by its own Save button: `<fieldset>` carries
 *  role=group, and the capture form above the list has several of its own. */
const openEditors = () => screen.queryAllByRole("button", { name: "Save" });
const editButtons = () => screen.getAllByRole("button", { name: "Edit" });

describe("GiftsSection", () => {
  it("unions suggestions and givings of one idea into a single entry", () => {
    renderGifts({
      suggestions: [suggestion({ giftIdeaId: "i-1", ideaTitle: "Kite" })],
      gifts: [given({ giftIdeaId: "i-1", ideaTitle: "Kite" })],
    });

    expect(ideaOrder()).toEqual(["Kite"]);
    expect(screen.getByText(/Suggested/)).toBeTruthy();
    expect(screen.getByText(/✓ Given/)).toBeTruthy();
  });

  it("keeps not-yet-given ideas on top and sinks given ones", () => {
    // A given idea is still a fine idea to give again, so it stays listed —
    // it just stops being the shopping list.
    renderGifts({
      suggestions: [
        suggestion({ id: "s-1", giftIdeaId: "i-1", ideaTitle: "Given one" }),
        suggestion({
          id: "s-2",
          giftIdeaId: "i-2",
          ideaTitle: "Unauthenticated one",
        }),
      ],
      gifts: [given({ giftIdeaId: "i-1", ideaTitle: "Given one" })],
    });

    expect(ideaOrder()).toEqual(["Unauthenticated one", "Given one"]);
  });

  it("says so when there is nothing for this recipient", () => {
    renderGifts();
    expect(screen.getByText("No gifts yet.")).toBeTruthy();
  });

  it("removes a suggestion through the application's port", async () => {
    const { ports, onChanged } = renderGifts({
      suggestions: [suggestion()],
    });

    await act(async () =>
      screen.getAllByRole("button", { name: "Remove" })[0]?.click(),
    );

    expect(ports.removeSuggestion).toHaveBeenCalledWith("s-1");
    expect(onChanged).toHaveBeenCalled();
  });

  it("removes a giving through its own port, not the suggestion one", async () => {
    const { ports } = renderGifts({ gifts: [given()] });

    await act(async () =>
      screen.getAllByRole("button", { name: "Remove" })[0]?.click(),
    );

    expect(ports.removeGiving).toHaveBeenCalledWith("g-1");
    expect(ports.removeSuggestion).not.toHaveBeenCalled();
  });

  it("opens one adornments editor at a time", async () => {
    // Otherwise the list grows a form per row.
    renderGifts({
      suggestions: [
        suggestion({ id: "s-1", giftIdeaId: "i-1", ideaTitle: "A" }),
        suggestion({ id: "s-2", giftIdeaId: "i-2", ideaTitle: "B" }),
      ],
    });

    await act(async () => editButtons()[0]?.click());
    expect(openEditors()).toHaveLength(1);

    await act(async () => editButtons()[1]?.click());
    expect(openEditors()).toHaveLength(1);
  });
});

const ideaSuggestion = (
  over: Partial<IdeaSuggestionRow> = {},
): IdeaSuggestionRow => ({
  id: "s-1",
  giftIdeaId: "i-1",
  recipientType: "person",
  recipientId: "p-1",
  recipientLabel: "Ada",
  occasionLabel: null,
  occasionType: null,
  occasionId: null,
  targetYear: null,
  targetMonth: null,
  targetDay: null,
  ...over,
});

const candidates = [
  { type: "person" as const, id: "p-1", label: "Ada" },
  { type: "person" as const, id: "p-2", label: "Grace" },
];

function renderIdeaRecipients(suggestions: IdeaSuggestionRow[]) {
  const ports = fakeGiftsPorts();
  const onChanged = vi.fn();
  renderWithGifts(
    <GiftIdeaRecipientsSection
      ideaId="i-1"
      suggestions={suggestions}
      candidates={candidates}
      onChanged={onChanged}
    />,
    ports,
  );
  return { ports, onChanged };
}

describe("GiftIdeaRecipientsSection", () => {
  it("does not offer someone the idea is already suggested for", () => {
    renderIdeaRecipients([ideaSuggestion()]);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "ada" },
    });
    expect(screen.queryAllByRole("option").map((o) => o.textContent)).toEqual(
      [],
    );
  });

  it("writes the same suggestion row a person page would", async () => {
    const { ports } = renderIdeaRecipients([]);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "grace" },
    });
    await act(async () =>
      fireEvent.mouseDown(screen.getByRole("option", { name: "Grace" })),
    );

    expect(ports.createSuggestion).toHaveBeenCalledWith({
      giftIdeaId: "i-1",
      recipientType: "person",
      recipientId: "p-2",
    });
  });

  it("says so when the idea is suggested for nobody", () => {
    renderIdeaRecipients([]);
    expect(screen.getByText("Not suggested for anyone yet.")).toBeTruthy();
  });
});
