import { describe, expect, it } from "vitest";
import { type DuplicateInput, scoreDuplicate } from "./duplicate-score.js";

const person = (over: Partial<DuplicateInput> = {}): DuplicateInput => ({
  name: "Jane Wainwright",
  foldedName: "jane wainwright",
  emails: [],
  phones: [],
  handles: [],
  ...over,
});

describe("scoreDuplicate — social handles", () => {
  it("treats a shared handle on one platform as a shared contact", () => {
    const handles = [{ platform: "instagram", handle: "janewainwright" }];
    const { tier, reasons } = scoreDuplicate(
      person({ handles }),
      person({ handles }),
    );
    expect(tier).toBe("high");
    expect(reasons).toContain("Shared instagram handle janewainwright");
  });

  it("does not pair the same handle held on different platforms", () => {
    // "@jane" on Instagram and "@jane" on TikTok are routinely different people,
    // so this must fall back to the name-only signal rather than reading as a
    // shared contact.
    const { tier, reasons } = scoreDuplicate(
      person({ handles: [{ platform: "instagram", handle: "jane" }] }),
      person({ handles: [{ platform: "tiktok", handle: "jane" }] }),
    );
    expect(tier).toBe("medium");
    expect(reasons).toEqual(['Same name "Jane Wainwright"']);
  });

  it("rates a shared handle alone as medium, with no name match", () => {
    const handles = [{ platform: "x", handle: "janewainwright" }];
    const { tier } = scoreDuplicate(
      person({
        name: "Jane Wainwright",
        foldedName: "jane wainwright",
        handles,
      }),
      person({ name: "J. Wainwright", foldedName: "j wainwright", handles }),
    );
    expect(tier).toBe("medium");
  });

  it("reports one reason for a handle listed twice", () => {
    const handles = [
      { platform: "instagram", handle: "janewainwright" },
      { platform: "instagram", handle: "janewainwright" },
    ];
    const { reasons } = scoreDuplicate(
      person({ handles }),
      person({ handles }),
    );
    expect(
      reasons.filter((r) => r.startsWith("Shared instagram")),
    ).toHaveLength(1);
  });
});

describe("scoreDuplicate", () => {
  it("rates a shared contact + equal name as high, with both reasons", () => {
    const a = person({ emails: ["jane@x.com"] });
    const b = person({ emails: ["jane@x.com"] });
    const { tier, reasons } = scoreDuplicate(a, b);
    expect(tier).toBe("high");
    expect(reasons).toContain("Shared email jane@x.com");
    expect(reasons).toContain('Same name "Jane Wainwright"');
  });

  it("rates an equal name with no shared contact as medium", () => {
    const { tier, reasons } = scoreDuplicate(person(), person());
    expect(tier).toBe("medium");
    expect(reasons).toEqual(['Same name "Jane Wainwright"']);
  });

  it("rates a shared contact with different names as medium", () => {
    const a = person({
      name: "William Bailey",
      foldedName: "william bailey",
      phones: ["+15551234567"],
    });
    const b = person({
      name: "Billy Bailey",
      foldedName: "billy bailey",
      phones: ["+15551234567"],
    });
    const { tier, reasons } = scoreDuplicate(a, b);
    expect(tier).toBe("medium");
    expect(reasons).toEqual(["Shared phone +15551234567"]);
  });

  it("rates no shared signal as none", () => {
    const a = person({
      name: "Harry Martini",
      foldedName: "harry martini",
      emails: ["harry@x.com"],
    });
    const b = person({
      name: "Jane Wainwright",
      foldedName: "jane wainwright",
      emails: ["jane@x.com"],
    });
    expect(scoreDuplicate(a, b).tier).toBe("none");
  });

  it("never pairs two people with empty folded names", () => {
    const a = person({ name: "", foldedName: "" });
    const b = person({ name: "", foldedName: "" });
    expect(scoreDuplicate(a, b).tier).toBe("none");
  });

  it("still pairs two nameless people who share a contact", () => {
    const a = person({ name: "", foldedName: "", emails: ["shared@x.com"] });
    const b = person({ name: "", foldedName: "", emails: ["shared@x.com"] });
    expect(scoreDuplicate(a, b).tier).toBe("medium");
  });

  it("reports every shared contact value as a reason", () => {
    const a = person({ emails: ["jane@x.com"], phones: ["+1555"] });
    const b = person({ emails: ["jane@x.com"], phones: ["+1555"] });
    const { reasons } = scoreDuplicate(a, b);
    expect(reasons).toContain("Shared email jane@x.com");
    expect(reasons).toContain("Shared phone +1555");
  });
});
