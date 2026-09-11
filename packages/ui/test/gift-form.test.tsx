import { describe, expect, it } from "vitest";
import {
  type PartyOption,
  type RecipientEntry,
  captureRecipientOf,
  giftIdeaOf,
  newRecipientEntry,
  partyKey,
  patchRecipient,
  removeRecipient,
} from "../src/headless/index.js";

const violet: PartyOption = { type: "person", id: "a", label: "Violet" };
const rufus: PartyOption = { type: "pet", id: "r", label: "Rufus" };

describe("giftIdeaOf", () => {
  const pool = [
    { id: "socks-id", title: "Socks" },
    { id: "kite-id", title: "Kite" },
  ];

  it("reuses an existing idea rather than minting a second under one title", () => {
    expect(giftIdeaOf({ title: "Socks", url: "" }, pool)).toEqual({
      id: "socks-id",
    });
  });

  it("matches regardless of case and surrounding space", () => {
    expect(giftIdeaOf({ title: "  sOcKs ", url: "" }, pool)).toEqual({
      id: "socks-id",
    });
  });

  it("mints a new idea for an unseen title, carrying the link", () => {
    expect(
      giftIdeaOf({ title: "Sled", url: "https://sleds.example" }, pool),
    ).toEqual({ title: "Sled", url: "https://sleds.example" });
  });

  it("omits an empty link rather than minting a blank one", () => {
    expect(giftIdeaOf({ title: "Sled", url: "   " }, pool)).toEqual({
      title: "Sled",
    });
  });

  it("leaves a near-duplicate title alone", () => {
    // "Wool socks" is not "Socks" — tolerated by design; the reconciliation
    // substrate is where near-duplicates are dealt with, not here.
    expect(giftIdeaOf({ title: "Wool socks", url: "" }, pool)).toEqual({
      title: "Wool socks",
    });
  });
});

describe("captureRecipientOf", () => {
  it("carries the party and the tick, dropping the label", () => {
    expect(captureRecipientOf(violet, true)).toEqual({
      party: { type: "person", id: "a" },
      given: true,
    });
  });

  it("says so explicitly when the gift has not been given", () => {
    expect(captureRecipientOf(rufus, false)).toEqual({
      party: { type: "pet", id: "r" },
      given: false,
    });
  });
});

describe("newRecipientEntry", () => {
  it("starts a freshly picked party as not-yet-given", () => {
    expect(newRecipientEntry(violet)).toEqual({ option: violet, given: false });
  });
});

describe("partyKey", () => {
  it("keys a person and a pet with the same id apart", () => {
    expect(partyKey({ type: "person", id: "x" })).not.toBe(
      partyKey({ type: "pet", id: "x" }),
    );
  });
});

describe("patchRecipient / removeRecipient", () => {
  const entries: RecipientEntry[] = [
    { option: violet, given: false },
    { option: rufus, given: false },
  ];

  it("patches only the addressed recipient", () => {
    const next = patchRecipient(entries, partyKey(violet), { given: true });
    expect(next[0].given).toBe(true);
    expect(next[1].given).toBe(false);
  });

  it("leaves the list alone when the key matches nobody", () => {
    expect(patchRecipient(entries, "person:nobody", { given: true })).toEqual(
      entries,
    );
  });

  it("does not mutate the caller's list", () => {
    patchRecipient(entries, partyKey(violet), { given: true });
    expect(entries[0].given).toBe(false);
  });

  it("removes the addressed recipient and nobody else", () => {
    const next = removeRecipient(entries, partyKey(violet));
    expect(next.map((e) => e.option.label)).toEqual(["Rufus"]);
  });

  it("keys a person and a pet with the same id apart when removing", () => {
    const sameId: RecipientEntry[] = [
      { option: { type: "person", id: "x", label: "Person X" }, given: false },
      { option: { type: "pet", id: "x", label: "Pet X" }, given: false },
    ];
    const next = removeRecipient(sameId, "person:x");
    expect(next.map((e) => e.option.label)).toEqual(["Pet X"]);
  });
});
