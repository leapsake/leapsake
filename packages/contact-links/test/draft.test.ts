import type { ContactMethod } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  HANDLE_PLATFORMS,
  contactMethodDraftFilled,
  contactMethodDraftOf,
  contactMethodDraftWithKind,
  contactMethodInputOf,
} from "../src/index.js";

const spine = {
  id: "c-1",
  ownerType: "person",
  ownerId: "p-1",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
} as const;

describe("contactMethodDraftOf", () => {
  it("starts a kind blank, with its first suggested label and texting assumed", () => {
    const draft = contactMethodDraftOf("phone");
    expect(draft).toMatchObject({
      kind: "phone",
      label: "Mobile",
      number: "",
      smsCapable: true,
      platform: HANDLE_PLATFORMS[0]!.id,
    });
  });

  it("starts from a saved phone, nulls as empty text", () => {
    const entry: ContactMethod = {
      kind: "phone",
      method: {
        ...spine,
        label: "Work",
        number: "555-0100",
        normalized: "5550100",
        extension: null,
        smsCapable: false,
        reachableOn: ["whatsapp"],
      },
    };
    expect(contactMethodDraftOf(entry)).toMatchObject({
      kind: "phone",
      label: "Work",
      number: "555-0100",
      extension: "",
      smsCapable: false,
      reachableOn: ["whatsapp"],
    });
  });

  it("starts from a saved social profile on a platform the registry doesn't know", () => {
    const entry: ContactMethod = {
      kind: "social",
      method: {
        ...spine,
        label: "Personal",
        platform: "Mastodon",
        handle: "mary",
        normalized: "mary",
        platformUserId: null,
        url: "https://example.test/@mary",
      },
    };
    expect(contactMethodDraftOf(entry)).toMatchObject({
      platform: "Mastodon",
      handle: "mary",
      platformUserId: "",
      url: "https://example.test/@mary",
    });
  });
});

describe("contactMethodDraftWithKind", () => {
  it("re-seeds a suggested label, and keeps what was typed under the old kind", () => {
    const phone = { ...contactMethodDraftOf("phone"), number: "555-0100" };
    const email = contactMethodDraftWithKind(phone, "email");
    expect(email).toMatchObject({ kind: "email", label: "Home" });
    expect(contactMethodDraftWithKind(email, "phone").number).toBe("555-0100");
  });

  it("keeps a label the user typed", () => {
    const draft = { ...contactMethodDraftOf("phone"), label: "Bedford Falls" };
    expect(contactMethodDraftWithKind(draft, "email").label).toBe(
      "Bedford Falls",
    );
  });

  it("sets the platform with the kind", () => {
    expect(
      contactMethodDraftWithKind(contactMethodDraftOf(), "social", "").platform,
    ).toBe("");
  });
});

describe("contactMethodDraftFilled", () => {
  it("asks each kind for the one thing it holds; social takes a handle or a URL", () => {
    expect(contactMethodDraftFilled(contactMethodDraftOf("email"))).toBe(false);
    const social = contactMethodDraftOf("social");
    expect(contactMethodDraftFilled(social)).toBe(false);
    expect(
      contactMethodDraftFilled({ ...social, url: "https://example.test" }),
    ).toBe(true);
  });
});

describe("contactMethodInputOf", () => {
  it("trims an email", () => {
    expect(
      contactMethodInputOf({
        ...contactMethodDraftOf("email"),
        label: " Home ",
        address: " george@example.test ",
      }),
    ).toEqual({
      ok: true,
      input: { kind: "email", label: "Home", address: "george@example.test" },
    });
  });

  it("nulls a blank extension", () => {
    const shaped = contactMethodInputOf({
      ...contactMethodDraftOf("phone"),
      number: " 555-0100 ",
      extension: "  ",
      reachableOn: ["whatsapp"],
    });
    expect(shaped).toEqual({
      ok: true,
      input: {
        kind: "phone",
        label: "Mobile",
        number: "555-0100",
        extension: null,
        smsCapable: true,
        reachableOn: ["whatsapp"],
      },
    });
  });

  it("nulls a postal address's blank optional lines and uppercases the country", () => {
    const shaped = contactMethodInputOf({
      ...contactMethodDraftOf("postal"),
      line1: "320 Sycamore",
      locality: "Bedford Falls",
      country: "us",
    });
    expect(shaped).toEqual({
      ok: true,
      input: {
        kind: "postal",
        label: "Home",
        line1: "320 Sycamore",
        line2: null,
        locality: "Bedford Falls",
        region: null,
        postalCode: null,
        country: "US",
      },
    });
  });

  it("reduces a pasted profile URL to the handle", () => {
    const shaped = contactMethodInputOf({
      ...contactMethodDraftOf("social"),
      platform: "instagram",
      handle: "https://instagram.com/georgebailey",
    });
    expect(shaped.ok && shaped.input).toMatchObject({
      platform: "instagram",
      handle: "georgebailey",
      url: null,
    });
  });

  it("refuses a blank label, and the field its kind exists for", () => {
    expect(
      contactMethodInputOf({ ...contactMethodDraftOf("email"), label: " " }),
    ).toEqual({
      ok: false,
      errors: { label: "required", address: "required" },
    });
    expect(contactMethodInputOf(contactMethodDraftOf("phone"))).toEqual({
      ok: false,
      errors: { number: "required" },
    });
    expect(contactMethodInputOf(contactMethodDraftOf("postal"))).toEqual({
      ok: false,
      errors: { line1: "required" },
    });
  });

  it("refuses a social profile with no platform, or with neither handle nor URL", () => {
    expect(
      contactMethodInputOf({ ...contactMethodDraftOf("social"), platform: "" }),
    ).toEqual({
      ok: false,
      errors: { platform: "required", handle: "required" },
    });
    expect(
      contactMethodInputOf({
        ...contactMethodDraftOf("social"),
        url: "https://example.test/george",
      }).ok,
    ).toBe(true);
  });
});
