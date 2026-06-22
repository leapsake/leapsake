import { describe, expect, it } from "vitest";
import { type DuplicateInput, scoreDuplicate } from "./duplicate-score.js";

const person = (over: Partial<DuplicateInput> = {}): DuplicateInput => ({
  name: "Jane Doe",
  foldedName: "jane doe",
  emails: [],
  phones: [],
  ...over,
});

describe("scoreDuplicate", () => {
  it("rates a shared contact + equal name as high, with both reasons", () => {
    const a = person({ emails: ["jane@x.com"] });
    const b = person({ emails: ["jane@x.com"] });
    const { tier, reasons } = scoreDuplicate(a, b);
    expect(tier).toBe("high");
    expect(reasons).toContain("Shared email jane@x.com");
    expect(reasons).toContain('Same name "Jane Doe"');
  });

  it("rates an equal name with no shared contact as medium", () => {
    const { tier, reasons } = scoreDuplicate(person(), person());
    expect(tier).toBe("medium");
    expect(reasons).toEqual(['Same name "Jane Doe"']);
  });

  it("rates a shared contact with different names as medium", () => {
    const a = person({
      name: "Bob Smith",
      foldedName: "bob smith",
      phones: ["+15551234567"],
    });
    const b = person({
      name: "Robert Smith",
      foldedName: "robert smith",
      phones: ["+15551234567"],
    });
    const { tier, reasons } = scoreDuplicate(a, b);
    expect(tier).toBe("medium");
    expect(reasons).toEqual(["Shared phone +15551234567"]);
  });

  it("rates no shared signal as none", () => {
    const a = person({
      name: "Bob Smith",
      foldedName: "bob smith",
      emails: ["bob@x.com"],
    });
    const b = person({
      name: "Jane Doe",
      foldedName: "jane doe",
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
