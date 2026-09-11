import { describe, expect, it } from "vitest";
import { type DeviceContact, deviceContactToParsed } from "./device-contacts";

/** A device record with sensible empty defaults, overridable per test. */
function device(overrides: Partial<DeviceContact> = {}): DeviceContact {
  return {
    givenName: null,
    middleName: null,
    familyName: null,
    fullName: null,
    company: null,
    note: null,
    emails: [],
    phones: [],
    addresses: [],
    birthday: null,
    dates: [],
    ...overrides,
  };
}

describe("deviceContactToParsed", () => {
  it("maps a full person record onto the Leapsake shape", () => {
    const parsed = deviceContactToParsed(
      device({
        givenName: "Jane",
        middleName: "Q",
        familyName: "Wainwright",
        fullName: "Jane Q Wainwright",
        emails: [{ id: "1", label: "work", address: "jane@example.com" }],
        phones: [{ id: "2", label: "mobile", number: "+15551234567" }],
      }),
    );

    expect(parsed.name).toEqual({
      firstName: "Jane",
      middleName: "Q",
      lastName: "Wainwright",
    });
    expect(parsed.displayName).toBe("Jane Q Wainwright");
    expect(parsed.gender).toBeNull();
    expect(parsed.emails).toEqual([
      { label: "work", address: "jane@example.com" },
    ]);
    expect(parsed.phones).toEqual([
      {
        label: "mobile",
        number: "+15551234567",
        extension: null,
        country: null,
        smsCapable: true,
      },
    ]);
  });

  it("leaves lastName empty for a company card and drops the organisation", () => {
    const parsed = deviceContactToParsed(
      device({ fullName: "Acme Corp", company: "Acme Corp" }),
    );

    expect(parsed.name.firstName).toBe("");
    expect(parsed.name.lastName).toBe("");
    expect(parsed.displayName).toBe("Acme Corp");
    expect(parsed.dropped).toContainEqual({
      property: "Organization",
      value: "Acme Corp",
    });
  });

  it("keeps a 1-indexed birthday as-is (no month offset)", () => {
    const withYear = deviceContactToParsed(
      device({ birthday: { year: 1990, month: 3, day: 14 } }),
    );
    expect(withYear.birthday).toEqual({ year: 1990, month: 3, day: 14 });

    // A year-less birthday is a partial civil date.
    const noYear = deviceContactToParsed(
      device({ birthday: { month: 12, day: 25 } as never }),
    );
    expect(noYear.birthday).toEqual({ year: null, month: 12, day: 25 });
  });

  it("ignores an out-of-range birthday month", () => {
    const parsed = deviceContactToParsed(
      device({ birthday: { month: 0, day: 0 } as never }),
    );
    expect(parsed.birthday).toBeNull();
  });

  it("maps an anniversary from the dates list, unwrapping Apple's label", () => {
    const parsed = deviceContactToParsed(
      device({
        dates: [
          {
            id: "1",
            label: "_$!<Anniversary>!$_",
            date: { year: 2015, month: 6, day: 20 },
          },
        ],
      }),
    );
    expect(parsed.dates).toEqual([
      {
        kind: "anniversary",
        label: "Anniversary",
        date: { year: 2015, month: 6, day: 20 },
        // A device contact carries no Leapsake ids — those are the writer's
        // side of `X-LEAPSAKE-MILESTONE-*`, absent on anything iOS hands us.
        id: null,
        note: null,
        relationshipId: null,
      },
    ]);
    // An anniversary is not a birthday, and must not be mistaken for one.
    expect(parsed.birthday).toBeNull();
  });

  it("reads iOS's year-less date sentinel as no year, not as a year", () => {
    // What an anniversary saved with the year left off actually arrives as: iOS
    // fills the unset component with `NSDateComponentUndefined` (`NSIntegerMax`),
    // and passing that on used to fail the whole contact at the write. Written as
    // `2 ** 63` because that is the double the bridge hands us — the exact
    // `9223372036854775807` is not representable as a JS number.
    const undefinedComponent = 2 ** 63;
    const parsed = deviceContactToParsed(
      device({
        dates: [
          {
            id: "1",
            label: "_$!<Anniversary>!$_",
            date: { year: undefinedComponent, month: 11, day: 14 },
          },
        ],
      }),
    );
    expect(parsed.dates).toEqual([
      {
        kind: "anniversary",
        label: "Anniversary",
        date: { year: null, month: 11, day: 14 },
        id: null,
        note: null,
        relationshipId: null,
      },
    ]);
  });

  it("ignores a date component no civil date could hold", () => {
    const parsed = deviceContactToParsed(
      device({
        birthday: { year: 0, month: 3, day: 99 },
      }),
    );
    expect(parsed.birthday).toEqual({ year: null, month: 3, day: null });
  });

  it("takes a birthday from the dates list only when there is no dedicated one", () => {
    // Android: no dedicated birthday field at all, so `dates` is the only source.
    const android = deviceContactToParsed(
      device({
        dates: [
          {
            id: "1",
            label: "birthday",
            date: { year: 1988, month: 2, day: 9 },
          },
        ],
      }),
    );
    expect(android.birthday).toEqual({ year: 1988, month: 2, day: 9 });
    // It fills the birthday rather than becoming a second dated milestone.
    expect(android.dates).toEqual([]);

    // iOS: the dedicated field wins, and a duplicate entry mints nothing extra.
    const ios = deviceContactToParsed(
      device({
        birthday: { year: 1990, month: 3, day: 14 },
        dates: [
          {
            id: "1",
            label: "_$!<Birthday>!$_",
            date: { year: 1990, month: 3, day: 14 },
          },
        ],
      }),
    );
    expect(ios.birthday).toEqual({ year: 1990, month: 3, day: 14 });
    expect(ios.dates).toEqual([]);
  });

  /**
   * iOS's own date picker offers only Anniversary and Other, so every other kind
   * arrives as a *custom* label the user typed — unwrapped free text, not one of
   * Apple's `_$!<>!$_` constants. That is the shape this path actually sees.
   */
  it("mints a milestone from a custom date label", () => {
    const parsed = deviceContactToParsed(
      device({
        dates: [
          {
            id: "1",
            label: "Graduation",
            date: { month: 5, day: 30 } as never,
          },
        ],
      }),
    );
    expect(parsed.dates).toEqual([
      {
        kind: "graduation",
        label: "Graduation",
        date: { year: null, month: 5, day: 30 },
        id: null,
        note: null,
        relationshipId: null,
      },
    ]);
    expect(parsed.dropped).toEqual([]);
  });

  /** The label, not the slug — `job-start` answers to "Started a job". Shared
   *  with the vCard importer through `apple-labels.ts`, tested on both sides
   *  because the two paths reach it with differently-cased text. */
  it("reads a multi-word label that is nothing like its slug", () => {
    const parsed = deviceContactToParsed(
      device({
        dates: [
          {
            id: "1",
            label: "Started a job",
            date: { year: 2019, month: 5, day: 30 },
          },
        ],
      }),
    );
    expect(parsed.dates).toMatchObject([
      { kind: "job-start", label: "Started a job" },
    ]);
  });

  it("names a date it has no kind for in dropped, rather than guessing", () => {
    const parsed = deviceContactToParsed(
      device({
        dates: [
          {
            id: "1",
            // An `other`-shaped label: the user's own note, which no map can
            // ever resolve — so this stays dropped however wide `DATE_KINDS`
            // grows.
            label: "Beach house closing",
            date: { month: 5, day: 30 } as never,
          },
        ],
      }),
    );
    expect(parsed.dates).toEqual([]);
    expect(parsed.dropped).toContainEqual({
      property: "Date (Beach house closing)",
      value: "05-30",
    });
  });

  it("ignores a date entry with no usable month", () => {
    const parsed = deviceContactToParsed(
      device({
        dates: [
          { id: "1", label: "anniversary", date: { month: 13, day: 1 } },
          { id: "2", label: "anniversary" },
        ],
      }),
    );
    expect(parsed.dates).toEqual([]);
    expect(parsed.dropped).toEqual([]);
  });

  it("keeps a postal country only when it is an ISO alpha-2 code", () => {
    const iso = deviceContactToParsed(
      device({
        addresses: [
          {
            id: "1",
            label: "home",
            street: "1 Main St",
            city: "Springfield",
            state: "IL",
            postcode: "62704",
            country: "us",
          },
        ],
      }),
    );
    expect(iso.postals).toEqual([
      {
        label: "home",
        line1: "1 Main St",
        line2: null,
        locality: "Springfield",
        region: "IL",
        postalCode: "62704",
        country: "US",
      },
    ]);

    const named = deviceContactToParsed(
      device({
        addresses: [
          { id: "1", label: "home", street: "1 Main St", country: "USA" },
        ],
      }),
    );
    expect(named.postals[0]?.country).toBeNull();
  });

  it("unwraps Apple's label constants into display text", () => {
    const parsed = deviceContactToParsed(
      device({
        emails: [
          { id: "1", label: "_$!<Work>!$_", address: "jane@example.com" },
          { id: "2", label: "iCloud", address: "jane@icloud.com" },
        ],
        phones: [
          { id: "3", label: "_$!<Mobile>!$_", number: "+15551234567" },
          { id: "4", label: "_$!<HomeFAX>!$_", number: "+15559876543" },
          // Shipped unwrapped by Apple; rewritten to match the vCard parser.
          { id: "5", label: "iPhone", number: "+15550001111" },
          // A custom label is free text and must survive verbatim.
          { id: "6", label: "Beach House", number: "+15552223333" },
        ],
        addresses: [{ id: "7", label: "_$!<Home>!$_", street: "1 Main St" }],
      }),
    );

    expect(parsed.emails.map((e) => e.label)).toEqual(["Work", "iCloud"]);
    expect(parsed.phones.map((p) => p.label)).toEqual([
      "Mobile",
      "Home fax",
      "Mobile",
      "Beach House",
    ]);
    expect(parsed.postals.map((p) => p.label)).toEqual(["Home"]);
  });

  it("drops entries with no usable value and defaults blank labels to 'Other'", () => {
    const parsed = deviceContactToParsed(
      device({
        emails: [
          { id: "1", address: "  " },
          { id: "2", label: "", address: "keep@example.com" },
        ],
        phones: [{ id: "3", number: undefined }],
        addresses: [{ id: "4", city: "Nowhere" }], // no street ⇒ dropped
      }),
    );
    expect(parsed.emails).toEqual([
      { label: "Other", address: "keep@example.com" },
    ]);
    expect(parsed.phones).toEqual([]);
    expect(parsed.postals).toEqual([]);
  });
});
