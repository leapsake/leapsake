import { describe, expect, it } from "vitest";
import { deterministicUuid } from "../src/index.js";

/**
 * The shape `z.uuid()` (zod 4) accepts: a hyphenated UUID whose version nibble is
 * 1–8 and whose variant nibble is one of 8/9/a/b. Mirrored here so the crypto
 * package can assert the property without taking a zod dependency; the schema and
 * integration suites prove the actual `z.uuid()` acceptance end-to-end.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministicUuid", () => {
  it("is stable: the same inputs always produce the same UUID", () => {
    const a = deterministicUuid("milestone", "abc:2026:day");
    const b = deterministicUuid("milestone", "abc:2026:day");
    expect(a).toBe(b);
  });

  it("distinguishes different names and different namespaces", () => {
    const base = deterministicUuid("milestone", "abc:2026:day");
    expect(deterministicUuid("milestone", "abc:2027:day")).not.toBe(base);
    expect(deterministicUuid("milestone", "abd:2026:day")).not.toBe(base);
    expect(deterministicUuid("holiday", "abc:2026:day")).not.toBe(base);
  });

  it("produces a valid UUID with the v5 version + RFC 4122 variant nibbles", () => {
    const id = deterministicUuid("milestone", "abc:2026:day");
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe("5"); // version nibble (first char of the 3rd group)
    expect("89ab").toContain(id[19]); // variant nibble (first char of 4th group)
  });
});
