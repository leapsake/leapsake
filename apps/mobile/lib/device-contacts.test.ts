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
    ...overrides,
  };
}

describe("deviceContactToParsed", () => {
  it("maps a full person record onto the Leapsake shape", () => {
    const parsed = deviceContactToParsed(
      device({
        givenName: "Jane",
        middleName: "Q",
        familyName: "Doe",
        fullName: "Jane Q Doe",
        emails: [{ id: "1", label: "work", address: "jane@example.com" }],
        phones: [{ id: "2", label: "mobile", number: "+15551234567" }],
      }),
    );

    expect(parsed.name).toEqual({
      firstName: "Jane",
      middleName: "Q",
      lastName: "Doe",
    });
    expect(parsed.displayName).toBe("Jane Q Doe");
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

  it("drops entries with no usable value and defaults blank labels to 'other'", () => {
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
      { label: "other", address: "keep@example.com" },
    ]);
    expect(parsed.phones).toEqual([]);
    expect(parsed.postals).toEqual([]);
  });
});
