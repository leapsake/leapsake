// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type GivenRow,
  type GivingRow,
  type PartyLoaders,
  type PartyOption,
  type RecipientEntry,
  captureRecipientOf,
  givingsOf,
  newGivingRow,
  newSuggestionFields,
  partyKey,
  patchRecipient,
  removeRecipient,
  usePartyContext,
} from "../src/headless/index.js";

afterEach(cleanup);

const ada: PartyOption = { type: "person", id: "p-1", label: "Ada" };
const rex: PartyOption = { type: "pet", id: "t-1", label: "Rex" };

const dated = (date: Partial<GivingRow["date"]>): GivingRow => ({
  ...newGivingRow(),
  date: { year: "", month: "", day: "", ...date },
});

describe("givingsOf", () => {
  it("drops a row with neither a date nor an occasion", () => {
    expect(givingsOf([newGivingRow(), newGivingRow()])).toEqual([]);
  });

  it("keeps a row with only an occasion", () => {
    const row = { ...newGivingRow(), occasion: { type: "holiday", id: "h-1" } };
    expect(givingsOf([row as GivingRow])).toEqual([
      { occasion: { type: "holiday", id: "h-1" } },
    ]);
  });

  it("keeps a row with only a date, parsed", () => {
    expect(
      givingsOf([dated({ year: "1941", month: "12", day: "25" })]),
    ).toEqual([{ date: { year: 1941, month: 12, day: 25 }, occasion: null }]);
  });

  it("drops a lone day, since a day needs a month", () => {
    expect(givingsOf([dated({ day: "25" })])).toEqual([]);
  });
});

describe("captureRecipientOf", () => {
  it("carries both arms — givings, and the suggestion's target date", () => {
    expect(
      captureRecipientOf(ada, [dated({ year: "2026" })], {
        date: { year: "2027", month: "", day: "" },
        occasion: { type: "milestone", id: "m-1" },
      }),
    ).toEqual({
      party: { type: "person", id: "p-1" },
      givings: [
        { date: { year: 2026, month: null, day: null }, occasion: null },
      ],
      suggestion: {
        occasion: { type: "milestone", id: "m-1" },
        targetDate: { year: 2027, month: null, day: null },
      },
    });
  });

  it("leaves the givings empty when every row is blank", () => {
    const entry = captureRecipientOf(rex, [newGivingRow()], {
      date: { year: "", month: "", day: "" },
      occasion: null,
    });
    expect(entry.givings).toEqual([]);
    expect(entry.suggestion).toEqual({ occasion: null, targetDate: null });
  });
});

describe("patchRecipient / removeRecipient", () => {
  const entries: RecipientEntry[] = [
    { option: ada, givings: [], suggestion: newSuggestionFields() },
    { option: rex, givings: [], suggestion: newSuggestionFields() },
  ];

  it("patches only the addressed recipient", () => {
    const givings = [newGivingRow()];
    const next = patchRecipient(entries, partyKey(rex), { givings });
    expect(next[0]?.givings).toEqual([]);
    expect(next[1]?.givings).toBe(givings);
  });

  it("leaves the list alone when the key matches nobody", () => {
    expect(patchRecipient(entries, "person:nobody", { givings: [] })).toEqual(
      entries,
    );
  });

  it("keys a person and a pet with the same id apart", () => {
    const collide: PartyOption = { type: "pet", id: "p-1", label: "Also p-1" };
    const both = [
      ...entries,
      { option: collide, givings: [], suggestion: newSuggestionFields() },
    ];
    expect(removeRecipient(both, partyKey(ada)).map((e) => e.option)).toEqual([
      rex,
      collide,
    ]);
  });
});

const givenRow = (over: Partial<GivenRow> = {}): GivenRow => ({
  id: "g-1",
  giftIdeaId: "i-1",
  ideaTitle: "BB gun",
  ideaUrl: null,
  giverLabel: null,
  occasionLabel: null,
  occasionType: null,
  occasionId: null,
  year: 1941,
  month: 12,
  day: 25,
  ...over,
});

/** A host that renders what the hook reports for each party in play. */
function Host({
  parties,
  loaders,
  giftIdeaId,
}: {
  parties: PartyOption[];
  loaders: PartyLoaders;
  giftIdeaId?: string;
}) {
  const pools = usePartyContext(parties, loaders);
  return (
    <ul>
      {parties.map((party) => (
        <li key={partyKey(party)}>
          <output aria-label={`${party.label} occasions`}>
            {pools
              .occasionsFor(party)
              .map((o) => o.label)
              .join("|")}
          </output>
          <output aria-label={`${party.label} given`}>
            {pools
              .alreadyGiven(party, giftIdeaId)
              .map((g) => g.ideaTitle)
              .join("|")}
          </output>
        </li>
      ))}
    </ul>
  );
}

const read = (label: string) => screen.getByLabelText(label).textContent;

function stubLoaders(over: Partial<PartyLoaders> = {}): PartyLoaders {
  return {
    loadOccasions: vi.fn(async () => []),
    loadGiven: vi.fn(async () => []),
    ...over,
  };
}

describe("usePartyContext", () => {
  it("reads empty before a party's fetch lands, rather than not rendering", () => {
    const loaders = stubLoaders({ loadOccasions: () => new Promise(() => {}) });
    render(<Host parties={[ada]} loaders={loaders} />);
    expect(read("Ada occasions")).toBe("");
  });

  it("fills a party's occasions once its fetch lands", async () => {
    const loaders = stubLoaders({
      loadOccasions: async () => [
        { type: "milestone", id: "m-1", label: "Birthday" },
        { type: "holiday", id: "h-1", label: "Christmas" },
      ],
    });
    render(<Host parties={[ada]} loaders={loaders} />);
    expect(await screen.findByText("Birthday|Christmas")).toBeDefined();
  });

  it("asks for each party once — adding a second does not re-ask for the first", async () => {
    const loaders = stubLoaders({
      loadOccasions: vi.fn(async (party) => [
        { type: "milestone" as const, id: "m", label: `for ${party.id}` },
      ]),
    });
    const { rerender } = render(<Host parties={[ada]} loaders={loaders} />);
    await screen.findByText("for p-1");

    rerender(<Host parties={[ada, rex]} loaders={loaders} />);
    await screen.findByText("for t-1");

    expect(loaders.loadOccasions).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loaders.loadOccasions).mock.calls.map(([p]) => p)).toEqual(
      [
        { type: "person", id: "p-1" },
        { type: "pet", id: "t-1" },
      ],
    );
  });

  it("reports nothing already given until an idea is named", async () => {
    const loaders = stubLoaders({ loadGiven: async () => [givenRow()] });
    render(<Host parties={[ada]} loaders={loaders} />);
    await screen.findByLabelText("Ada given");
    expect(read("Ada given")).toBe("");
  });

  it("reports only the named idea's givings — the re-gift guard", async () => {
    const loaders = stubLoaders({
      loadGiven: async () => [
        givenRow(),
        givenRow({ id: "g-2", giftIdeaId: "i-2", ideaTitle: "Decoder ring" }),
      ],
    });
    render(<Host parties={[ada]} loaders={loaders} giftIdeaId="i-2" />);
    expect(await screen.findByText("Decoder ring")).toBeDefined();
  });

  it("keeps each party's context to itself", async () => {
    const loaders = stubLoaders({
      loadGiven: async (party) =>
        party.type === "pet" ? [givenRow({ ideaTitle: "Chew toy" })] : [],
    });
    render(<Host parties={[ada, rex]} loaders={loaders} giftIdeaId="i-1" />);
    await screen.findByText("Chew toy");
    expect(read("Ada given")).toBe("");
  });
});
