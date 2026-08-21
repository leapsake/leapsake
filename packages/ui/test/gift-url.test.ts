import { describe, expect, it } from "vitest";
import {
  giftUrlLabel,
  giftUrlOf,
  pastedIntoField,
} from "../src/headless/index.js";

describe("giftUrlOf", () => {
  it("takes an absolute http(s) link", () => {
    expect(giftUrlOf("https://example.com/socks")).toBe(
      "https://example.com/socks",
    );
    expect(giftUrlOf("http://example.com")).toBe("http://example.com");
  });

  it("trims, since the field hands over what was typed", () => {
    expect(giftUrlOf("  https://example.com  ")).toBe("https://example.com");
  });

  // The point of the strictness: these are all plausible things to call a gift,
  // and a field that stole them would leave the name empty.
  it("leaves a plausible gift name alone", () => {
    expect(giftUrlOf("example.com")).toBeNull();
    expect(giftUrlOf("Example.com subscription")).toBeNull();
    expect(giftUrlOf("Socks")).toBeNull();
    expect(giftUrlOf("")).toBeNull();
  });

  it("takes only schemes you can shop from", () => {
    expect(giftUrlOf("mailto:josh@example.com")).toBeNull();
    expect(giftUrlOf("file:///Users/josh/socks.txt")).toBeNull();
  });

  it("returns the link as typed rather than normalized", () => {
    // `new URL` would append the root path; what was pasted is what should open.
    expect(giftUrlOf("https://example.com")).toBe("https://example.com");
  });
});

describe("pastedIntoField", () => {
  it("calls a single keystroke typing", () => {
    expect(pastedIntoField("Sock", "Socks")).toBe(false);
    expect(pastedIntoField("", "h")).toBe(false);
  });

  it("calls a jump a paste", () => {
    expect(pastedIntoField("", "https://example.com/socks")).toBe(true);
    expect(pastedIntoField("Socks", "Socks https://example.com")).toBe(true);
  });

  // The reason this exists: `https://e` already parses, so a field that checked
  // every keystroke would file a hand-typed link after nine characters and put
  // the rest of it in the name.
  it("does not fire partway through a hand-typed link", () => {
    const typed = "https://example.com";
    for (let i = 1; i < typed.length; i++) {
      expect(pastedIntoField(typed.slice(0, i), typed.slice(0, i + 1))).toBe(
        false,
      );
    }
  });

  it("is never a paste when the field shrank", () => {
    expect(pastedIntoField("https://example.com", "https")).toBe(false);
  });
});

describe("giftUrlLabel", () => {
  it("shows the host, without the www nobody reads", () => {
    expect(giftUrlLabel("https://www.example.com/a/b?c=d")).toBe("example.com");
    expect(giftUrlLabel("https://shop.example.co.uk/x")).toBe(
      "shop.example.co.uk",
    );
  });

  it("falls back to the whole string rather than showing nothing", () => {
    expect(giftUrlLabel("not a url")).toBe("not a url");
  });
});
