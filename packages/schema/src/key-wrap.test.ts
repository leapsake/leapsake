import { describe, expect, it } from "vitest";
import {
  addKeyWrapInputSchema,
  keyWrapSchema,
  principalKindSchema,
  wrappedKindSchema,
} from "./key-wrap.js";

const validRow = {
  id: crypto.randomUUID(),
  wrappedKind: "content" as const,
  contentKeyId: crypto.randomUUID(),
  principalKind: "master" as const,
  principalRef: null,
  ciphertext: new Uint8Array([1, 2, 3]),
  alg: "xchacha20poly1305.raw@1",
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

describe("wrappedKindSchema", () => {
  it("accepts the three wrapped kinds and rejects others", () => {
    for (const kind of ["master", "account_private", "content"]) {
      expect(wrappedKindSchema.parse(kind)).toBe(kind);
    }
    expect(() => wrappedKindSchema.parse("session")).toThrow();
  });
});

describe("principalKindSchema", () => {
  it("accepts the full documented set", () => {
    for (const kind of [
      "enclave",
      "recovery",
      "password",
      "master",
      "recipient",
      "server_principal",
      "session",
    ]) {
      expect(principalKindSchema.parse(kind)).toBe(kind);
    }
  });

  it("rejects an unknown principal kind", () => {
    expect(() => principalKindSchema.parse("admin")).toThrow();
  });
});

describe("keyWrapSchema", () => {
  it("parses a valid row", () => {
    expect(keyWrapSchema.parse(validRow)).toEqual(validRow);
  });

  it("requires ciphertext to be a Uint8Array", () => {
    expect(() =>
      keyWrapSchema.parse({ ...validRow, ciphertext: "deadbeef" }),
    ).toThrow();
  });

  it("allows a null contentKeyId for non-content wraps", () => {
    const row = {
      ...validRow,
      wrappedKind: "master" as const,
      contentKeyId: null,
      principalKind: "enclave" as const,
      principalRef: crypto.randomUUID(),
    };
    expect(keyWrapSchema.parse(row)).toEqual(row);
  });
});

describe("addKeyWrapInputSchema", () => {
  it("accepts the minimal wrapping input", () => {
    const input = {
      wrappedKind: "master" as const,
      principalKind: "enclave" as const,
      principalRef: "device-1",
      ciphertext: new Uint8Array([9]),
      alg: "xchacha20poly1305.raw@1",
    };
    expect(addKeyWrapInputSchema.parse(input)).toEqual(input);
  });
});
