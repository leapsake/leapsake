// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GiftIdeaRecipientsSection,
  GiftsSection,
  type GiftRecipientRow,
  type IdeaRecipientRow,
} from "../src/web/index.js";
import { fakeGiftsPorts, renderWithGifts } from "./gift-support.js";

afterEach(cleanup);

const STAMP = 1_760_000_000_000;

const gift = (over: Partial<GiftRecipientRow> = {}): GiftRecipientRow => ({
  id: "r-1",
  giftIdeaId: "i-1",
  ideaTitle: "Kite",
  ideaUrl: null,
  givenAt: null,
  ...over,
});

const forIdea = (over: Partial<IdeaRecipientRow> = {}): IdeaRecipientRow => ({
  id: "r-1",
  recipientType: "person",
  recipientId: "p-1",
  recipientLabel: "Mary",
  givenAt: null,
  ...over,
});

function renderGifts({
  gifts = [],
  ports = fakeGiftsPorts(),
}: {
  gifts?: GiftRecipientRow[];
  ports?: ReturnType<typeof fakeGiftsPorts>;
} = {}) {
  const onChanged = vi.fn();
  renderWithGifts(
    <GiftsSection
      recipientType="person"
      recipientId="p-1"
      recipientLabel="Mary"
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

/** The list's own ticks. The capture form above carries one of its own, which is
 *  labelled "Already gave it to …" rather than "Given". */
const listTicks = () =>
  screen.getAllByRole("checkbox", { name: "Given" }) as HTMLInputElement[];

describe("GiftsSection", () => {
  it("lists what this person is down for", () => {
    renderGifts({
      gifts: [
        gift({ ideaTitle: "Kite" }),
        gift({ id: "r-2", ideaTitle: "Book" }),
      ],
    });
    expect(ideaOrder()).toEqual(["Book", "Kite"]);
  });

  it("keeps outstanding ideas on top and sinks given ones", () => {
    renderGifts({
      gifts: [
        gift({ id: "r-1", ideaTitle: "Accordion", givenAt: STAMP }),
        gift({ id: "r-2", ideaTitle: "Zither" }),
      ],
    });
    expect(ideaOrder()).toEqual(["Zither", "Accordion"]);
  });

  it("shows the tick for a gift already given", () => {
    renderGifts({ gifts: [gift({ givenAt: STAMP })] });
    expect(listTicks()[0]?.checked).toBe(true);
  });

  it("shows an outstanding gift unticked", () => {
    renderGifts({ gifts: [gift()] });
    expect(listTicks()[0]?.checked).toBe(false);
  });

  it("says so when there is nothing for this recipient", () => {
    renderGifts();
    expect(screen.getByText("No gifts yet.")).toBeTruthy();
  });

  it("ticks a gift through the application's port", async () => {
    const { ports, onChanged } = renderGifts({ gifts: [gift()] });

    await act(async () => {
      fireEvent.click(listTicks()[0]);
    });

    expect(ports.setGiven).toHaveBeenCalledWith("r-1", true);
    expect(onChanged).toHaveBeenCalled();
  });

  it("unticks a gift that was already given", async () => {
    const { ports } = renderGifts({ gifts: [gift({ givenAt: STAMP })] });

    await act(async () => {
      fireEvent.click(listTicks()[0]);
    });

    expect(ports.setGiven).toHaveBeenCalledWith("r-1", false);
  });

  it("removes a gift through the application's port", async () => {
    const { ports } = renderGifts({ gifts: [gift()] });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });

    expect(ports.detachRecipient).toHaveBeenCalledWith("r-1");
  });

  it("links the idea's own page and its external link", () => {
    renderGifts({ gifts: [gift({ ideaUrl: "https://kites.example" })] });
    expect(
      screen.getByRole("link", { name: "Kite" }).getAttribute("href"),
    ).toBe("/gifts/i-1/edit");
    expect(
      screen.getByRole("link", { name: "link" }).getAttribute("href"),
    ).toBe("https://kites.example");
  });
});

function renderIdeaRecipients({
  recipients = [],
  candidates = [],
  ports = fakeGiftsPorts(),
}: {
  recipients?: IdeaRecipientRow[];
  candidates?: { type: "person" | "pet"; id: string; label: string }[];
  ports?: ReturnType<typeof fakeGiftsPorts>;
} = {}) {
  const onChanged = vi.fn();
  renderWithGifts(
    <GiftIdeaRecipientsSection
      ideaId="i-1"
      recipients={recipients}
      candidates={candidates}
      onChanged={onChanged}
    />,
    ports,
  );
  return { ports, onChanged };
}

describe("GiftIdeaRecipientsSection", () => {
  it("does not offer someone the idea is already for", () => {
    renderIdeaRecipients({
      recipients: [forIdea()],
      candidates: [
        { type: "person", id: "p-1", label: "Mary" },
        { type: "person", id: "p-2", label: "Harry" },
      ],
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "mary" },
    });
    expect(screen.queryAllByRole("option").map((o) => o.textContent)).toEqual(
      [],
    );
  });

  it("keys a person and a pet with the same id apart when excluding", () => {
    renderIdeaRecipients({
      recipients: [forIdea({ recipientType: "person", recipientId: "x" })],
      candidates: [
        { type: "person", id: "x", label: "Xander" },
        { type: "pet", id: "x", label: "Xanthe" },
      ],
    });

    // The person with id "x" is already on the idea; the *pet* with the same id
    // is a different party and stays offered.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "xan" },
    });
    expect(screen.queryAllByRole("option").map((o) => o.textContent)).toEqual([
      "Xanthe",
    ]);
  });

  it("writes the same link a person page would", async () => {
    const { ports, onChanged } = renderIdeaRecipients({
      candidates: [{ type: "person", id: "p-2", label: "Harry" }],
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "harry" },
    });
    await act(async () =>
      fireEvent.mouseDown(screen.getByRole("option", { name: "Harry" })),
    );

    expect(ports.attachRecipient).toHaveBeenCalledWith({
      giftIdeaId: "i-1",
      party: { type: "person", id: "p-2" },
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("ticks a recipient from the idea's end", async () => {
    const { ports } = renderIdeaRecipients({ recipients: [forIdea()] });

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Given to Mary" }));
    });

    expect(ports.setGiven).toHaveBeenCalledWith("r-1", true);
  });

  it("sinks the people who already have it", () => {
    renderIdeaRecipients({
      recipients: [
        forIdea({ id: "r-1", recipientLabel: "Mary", givenAt: STAMP }),
        forIdea({ id: "r-2", recipientLabel: "Zed" }),
      ],
    });

    const labels = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(labels[0]).toContain("Zed");
    expect(labels[1]).toContain("Mary");
  });

  it("says so when the idea is for nobody", () => {
    renderIdeaRecipients();
    expect(screen.getByText("Not for anyone in particular yet.")).toBeTruthy();
  });
});
