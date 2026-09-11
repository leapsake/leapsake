import { describe, expect, it } from "vitest";
import { bareHandle, phoneDigits, phoneE164 } from "../src/index.js";

describe("bareHandle", () => {
  it("passes a plain handle through untouched", () => {
    expect(bareHandle("joshsmith")).toBe("joshsmith");
  });

  it("preserves case, because that is how the person writes their name", () => {
    expect(bareHandle("@JoshSmith")).toBe("JoshSmith");
  });

  it("drops the @ people type because handles are written with one", () => {
    expect(bareHandle("@george")).toBe("george");
    expect(bareHandle("  @george  ")).toBe("george");
  });

  it("takes the last path segment of a pasted profile URL", () => {
    expect(bareHandle("https://instagram.com/george")).toBe("george");
    expect(bareHandle("https://www.instagram.com/george/")).toBe("george");
    expect(bareHandle("https://www.linkedin.com/in/george-bailey")).toBe(
      "george-bailey",
    );
    expect(bareHandle("https://bsky.app/profile/george.bsky.social")).toBe(
      "george.bsky.social",
    );
  });

  it("strips the @ out of a URL that carries one", () => {
    expect(bareHandle("https://www.tiktok.com/@george")).toBe("george");
  });

  it("drops a query string and fragment", () => {
    expect(bareHandle("https://x.com/george?s=20")).toBe("george");
    expect(bareHandle("george?utm_source=whatever")).toBe("george");
    expect(bareHandle("https://x.com/george#top")).toBe("george");
  });

  it("returns empty for input with nothing in it", () => {
    expect(bareHandle("")).toBe("");
    expect(bareHandle("   ")).toBe("");
    expect(bareHandle("https://instagram.com/")).toBe("");
  });
});

describe("phone normalization", () => {
  it("reduces a typed number to digits", () => {
    expect(phoneDigits("+1 (555) 010-9999")).toBe("15550109999");
    expect(phoneDigits("555.0109")).toBe("5550109");
  });

  it("adds the + E.164 links expect", () => {
    expect(phoneE164("+1 (555) 010-9999")).toBe("+15550109999");
    expect(phoneE164("555 0109")).toBe("+5550109");
  });

  it("returns empty rather than a bare + for a number with no digits", () => {
    expect(phoneE164("ask my mum")).toBe("");
    expect(phoneDigits("ask my mum")).toBe("");
  });
});
