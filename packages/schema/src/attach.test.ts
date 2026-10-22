import { describe, expect, it } from "vitest";
import { type AttachFields, attachTarget, canAttach } from "./attach.js";

function person(overrides: Partial<AttachFields> = {}): AttachFields {
  return {
    firstName: "George",
    middleName: null,
    lastName: "Bailey",
    gender: null,
    birthday: null,
    dates: [],
    emails: [],
    phones: [],
    postals: [],
    handles: [],
    ...overrides,
  };
}

const mobile = (value: string) => ({ label: "Mobile", value });
const email = (label: string, value: string) => ({ label, value });

describe("canAttach", () => {
  it("attaches a contact sharing the full name and a phone", () => {
    const stored = person({ phones: [mobile("+14125550101")] });
    const incoming = person({ phones: [mobile("+14125550101")] });
    expect(canAttach(incoming, stored)).toBe(true);
  });

  it("ignores case and accents in names", () => {
    const stored = person({ firstName: "José", phones: [mobile("+1")] });
    const incoming = person({ firstName: "jose", phones: [mobile("+1")] });
    expect(canAttach(incoming, stored)).toBe(true);
  });

  it("needs more than a matching name", () => {
    expect(canAttach(person(), person())).toBe(false);
  });

  it("needs the same full name, not just a shared value", () => {
    const stored = person({ phones: [mobile("+1")] });
    const incoming = person({ firstName: "Harry", phones: [mobile("+1")] });
    expect(canAttach(incoming, stored)).toBe(false);
  });

  it("never attaches a nameless contact", () => {
    const blank = { firstName: "", lastName: "", phones: [mobile("+1")] };
    expect(canAttach(person(blank), person(blank))).toBe(false);
  });

  it("counts a shared email or handle under any label", () => {
    const stored = person({ emails: [email("Home", "george@bailey.test")] });
    const incoming = person({ emails: [email("", "george@bailey.test")] });
    expect(canAttach(incoming, stored)).toBe(true);

    const withHandle = (platform: string) =>
      person({ handles: [{ platform, value: "georgebailey" }] });
    expect(canAttach(withHandle("Instagram"), withHandle("instagram"))).toBe(
      true,
    );
  });

  it("counts a birthday whose month and day agree, a year on one side only", () => {
    const stored = person({ birthday: { year: 1907, month: 2, day: 12 } });
    const incoming = person({ birthday: { year: null, month: 2, day: 12 } });
    expect(canAttach(incoming, stored)).toBe(true);
  });

  it("does not count a birthday with only a year", () => {
    const stored = person({ birthday: { year: 1907, month: 2, day: 12 } });
    const incoming = person({
      birthday: { year: 1907, month: null, day: null },
    });
    expect(canAttach(incoming, stored)).toBe(false);
  });

  it("allows a middle name on one side only, but not two different ones", () => {
    const shared = { phones: [mobile("+1")] };
    const stored = person({ ...shared, middleName: "Washington" });
    expect(canAttach(person(shared), stored)).toBe(true);
    expect(canAttach(person({ ...shared, middleName: "W" }), stored)).toBe(
      false,
    );
  });

  it("refuses a different gender or birthday", () => {
    const shared = { phones: [mobile("+1")] };
    expect(
      canAttach(
        person({ ...shared, gender: "male" }),
        person({ ...shared, gender: "female" }),
      ),
    ).toBe(false);
    expect(
      canAttach(
        person({ ...shared, birthday: { year: 1907, month: 2, day: 12 } }),
        person({ ...shared, birthday: { year: 1908, month: 2, day: 12 } }),
      ),
    ).toBe(false);
  });

  it("refuses two wedding dates, but not two graduations", () => {
    const shared = { phones: [mobile("+1")] };
    const on = (kind: "wedding" | "graduation", year: number) =>
      person({
        ...shared,
        dates: [{ kind, date: { year, month: 6, day: 1 } }],
      });
    expect(canAttach(on("wedding", 1932), on("wedding", 1934))).toBe(false);
    expect(canAttach(on("graduation", 1925), on("graduation", 1928))).toBe(
      true,
    );
  });

  it("refuses a changed number under the same label", () => {
    const shared = { emails: [email("Home", "george@bailey.test")] };
    const stored = person({ ...shared, phones: [mobile("+14125550101")] });
    const incoming = person({ ...shared, phones: [mobile("+14125550199")] });
    expect(canAttach(incoming, stored)).toBe(false);
  });

  it("treats ' work ' and 'Work' as one label", () => {
    const shared = { phones: [mobile("+1")] };
    const stored = person({ ...shared, emails: [email("Work", "a@bnl.test")] });
    const incoming = person({
      ...shared,
      emails: [email(" work ", "b@bnl.test")],
    });
    expect(canAttach(incoming, stored)).toBe(false);
  });

  it("lets values differ under different, missing or Other labels", () => {
    const shared = { emails: [email("Home", "george@bailey.test")] };
    const stored = person({
      ...shared,
      phones: [mobile("+1"), { label: "Other", value: "+2" }],
    });
    const incoming = person({
      ...shared,
      phones: [
        { label: "iPhone", value: "+3" },
        { label: "other", value: "+4" },
        { label: "", value: "+5" },
      ],
    });
    expect(canAttach(incoming, stored)).toBe(true);
  });

  it("needs one shared value per label used on both sides, not all of them", () => {
    const stored = person({
      emails: [email("Work", "a@bnl.test"), email("Work", "b@bnl.test")],
    });
    const incoming = person({ emails: [email("Work", "b@bnl.test")] });
    expect(canAttach(incoming, stored)).toBe(true);
  });

  it("refuses a changed address under the same label", () => {
    const shared = { phones: [mobile("+1")] };
    const home = (value: string) => ({ label: "Home", value });
    expect(
      canAttach(
        person({ ...shared, postals: [home("320 sycamore st bedford falls")] }),
        person({ ...shared, postals: [home("1 genesee st bedford falls")] }),
      ),
    ).toBe(false);
  });

  it("refuses a different handle on the same platform", () => {
    const shared = { phones: [mobile("+1")] };
    const on = (value: string) =>
      person({ ...shared, handles: [{ platform: "Instagram", value }] });
    expect(canAttach(on("georgebailey"), on("gbailey"))).toBe(false);
  });
});

describe("attachTarget", () => {
  const george = { id: "george", fields: person({ phones: [mobile("+1")] }) };
  const incoming = person({ phones: [mobile("+1")] });

  it("names the one person a contact can attach to", () => {
    const mary = {
      id: "mary",
      fields: person({ firstName: "Mary", lastName: "Hatch" }),
    };
    expect(attachTarget(incoming, [mary, george])).toBe(george);
  });

  it("attaches to nobody when two people qualify", () => {
    const twin = { id: "twin", fields: george.fields };
    expect(attachTarget(incoming, [george, twin])).toBeNull();
  });

  it("attaches to nobody when nobody qualifies", () => {
    expect(attachTarget(person(), [george])).toBeNull();
  });
});
