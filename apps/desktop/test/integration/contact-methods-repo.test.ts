import type {
  CreateEmailInput,
  CreatePhoneInput,
  CreatePostalInput,
} from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContactMethodsRepo,
  type SqliteDriver,
  createContactMethodsRepo,
  listContactMethods,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: ContactMethodsRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createContactMethodsRepo(driver);
});

afterEach(() => {
  cleanup();
});

function email(
  ownerId: string,
  over: Partial<CreateEmailInput> = {},
): CreateEmailInput {
  return {
    ownerType: "person",
    ownerId,
    label: "home",
    address: "Jane@Example.COM",
    ...over,
  };
}

function phone(
  ownerId: string,
  over: Partial<CreatePhoneInput> = {},
): CreatePhoneInput {
  return {
    ownerType: "person",
    ownerId,
    label: "mobile",
    number: "(555) 123-4567",
    ...over,
  };
}

function postal(
  ownerId: string,
  over: Partial<CreatePostalInput> = {},
): CreatePostalInput {
  return {
    ownerType: "person",
    ownerId,
    label: "home",
    line1: "1 Main St",
    locality: "Springfield",
    region: "IL",
    postalCode: "62704",
    country: "US",
    ...over,
  };
}

describe("emails", () => {
  it("creates an email with a uuid, derived normalized, timestamps, null deletedAt", async () => {
    const owner = crypto.randomUUID();
    const e = await repo.emails.create(email(owner));
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.ownerType).toBe("person");
    expect(e.ownerId).toBe(owner);
    expect(e.label).toBe("home");
    expect(e.address).toBe("Jane@Example.COM");
    expect(e.normalized).toBe("jane@example.com");
    expect(e.createdAt).toBeGreaterThan(0);
    expect(e.updatedAt).toBe(e.createdAt);
    expect(e.deletedAt).toBeNull();
  });

  it("re-derives normalized when the address changes on update", async () => {
    const created = await repo.emails.create(email(crypto.randomUUID()));
    const updated = await repo.emails.update(created.id, {
      address: "  NEW@Mail.io ",
    });
    expect(updated?.address).toBe("  NEW@Mail.io ");
    expect(updated?.normalized).toBe("new@mail.io");
  });

  it("permits duplicate addresses for one owner (no hard uniqueness)", async () => {
    const owner = crypto.randomUUID();
    await repo.emails.create(email(owner));
    await repo.emails.create(email(owner));
    expect(await repo.emails.listForOwner("person", owner)).toHaveLength(2);
  });

  it("hides a soft-deleted email and stops it being updated", async () => {
    const created = await repo.emails.create(email(crypto.randomUUID()));
    await repo.emails.softDelete(created.id);
    expect(await repo.emails.get(created.id)).toBeUndefined();
    expect(
      await repo.emails.update(created.id, { label: "work" }),
    ).toBeUndefined();
  });

  it("stores a free-text label verbatim", async () => {
    const e = await repo.emails.create(
      email(crypto.randomUUID(), { label: "Mum's place" }),
    );
    expect(e.label).toBe("Mum's place");
  });
});

describe("phones", () => {
  it("derives a digits-only normalized key and keeps a leading +", async () => {
    const national = await repo.phones.create(phone(crypto.randomUUID()));
    expect(national.normalized).toBe("5551234567");

    const e164 = await repo.phones.create(
      phone(crypto.randomUUID(), { number: "+1 (555) 123-4567" }),
    );
    expect(e164.normalized).toBe("+15551234567");
  });

  it("stores extension and country, and updates them", async () => {
    const created = await repo.phones.create(
      phone(crypto.randomUUID(), { extension: "42", country: "US" }),
    );
    expect(created.extension).toBe("42");
    expect(created.country).toBe("US");

    const updated = await repo.phones.update(created.id, {
      extension: null,
      country: "GB",
    });
    expect(updated?.extension).toBeNull();
    expect(updated?.country).toBe("GB");
  });

  it("rejects a malformed country code", async () => {
    await expect(
      repo.phones.create(phone(crypto.randomUUID(), { country: "USA" })),
    ).rejects.toThrow();
  });

  it("defaults smsCapable to true and lets it be set and updated", async () => {
    const textable = await repo.phones.create(phone(crypto.randomUUID()));
    expect(textable.smsCapable).toBe(true);

    const landline = await repo.phones.create(
      phone(crypto.randomUUID(), { smsCapable: false }),
    );
    expect(landline.smsCapable).toBe(false);

    const reenabled = await repo.phones.update(landline.id, {
      smsCapable: true,
    });
    expect(reenabled?.smsCapable).toBe(true);
  });
});

describe("postals", () => {
  it("requires line1 but allows the rest to be absent (international fit)", async () => {
    const minimal = await repo.postals.create({
      ownerType: "person",
      ownerId: crypto.randomUUID(),
      label: "home",
      line1: "PO Box 5",
    });
    expect(minimal.line1).toBe("PO Box 5");
    expect(minimal.locality).toBeNull();
    expect(minimal.region).toBeNull();
    expect(minimal.postalCode).toBeNull();
    expect(minimal.country).toBeNull();

    await expect(
      repo.postals.create(
        // @ts-expect-error line1 is required
        { ownerType: "person", ownerId: crypto.randomUUID(), label: "home" },
      ),
    ).rejects.toThrow();
  });

  it("updates structured fields", async () => {
    const created = await repo.postals.create(postal(crypto.randomUUID()));
    const updated = await repo.postals.update(created.id, {
      line2: "Apt 3",
      region: null,
    });
    expect(updated?.line2).toBe("Apt 3");
    expect(updated?.region).toBeNull();
    expect(updated?.locality).toBe("Springfield");
  });
});

describe("listContactMethods", () => {
  it("merges all three kinds for an owner, tagged by kind", async () => {
    const owner = crypto.randomUUID();
    await repo.emails.create(email(owner));
    await repo.phones.create(phone(owner));
    await repo.postals.create(postal(owner));
    // Another owner's methods must not leak in.
    await repo.emails.create(email(crypto.randomUUID()));

    const methods = await listContactMethods(repo, {
      type: "person",
      id: owner,
    });
    expect(methods.map((m) => m.kind)).toEqual(["email", "phone", "postal"]);
    const phoneEntry = methods.find((m) => m.kind === "phone");
    expect(phoneEntry?.method.ownerId).toBe(owner);
  });

  it("omits soft-deleted methods", async () => {
    const owner = crypto.randomUUID();
    const e = await repo.emails.create(email(owner));
    await repo.phones.create(phone(owner));
    await repo.emails.softDelete(e.id);

    const methods = await listContactMethods(repo, {
      type: "person",
      id: owner,
    });
    expect(methods.map((m) => m.kind)).toEqual(["phone"]);
  });
});

describe("removeAllForOwner", () => {
  it("soft-deletes every kind for one owner and leaves others untouched", async () => {
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    await repo.emails.create(email(owner));
    await repo.phones.create(phone(owner));
    await repo.postals.create(postal(owner));
    await repo.emails.create(email(other));

    await repo.removeAllForOwner("person", owner);
    expect(
      await listContactMethods(repo, { type: "person", id: owner }),
    ).toHaveLength(0);
    expect(
      await listContactMethods(repo, { type: "person", id: other }),
    ).toHaveLength(1);
  });
});
