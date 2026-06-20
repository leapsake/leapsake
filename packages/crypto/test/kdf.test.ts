import { describe, expect, it } from "vitest";
import {
  ARGON2_PARAMS,
  KEY_BYTES,
  SALT_BYTES,
  deriveKeyMaterial,
  generateSalt,
} from "../src/index.js";

describe("deriveKeyMaterial", () => {
  const salt = generateSalt();

  it("is deterministic for a given (password, salt)", () => {
    const a = deriveKeyMaterial("correct horse battery staple", salt);
    const b = deriveKeyMaterial("correct horse battery staple", salt);
    expect(a.kek).toEqual(b.kek);
    expect(a.authVerifier).toEqual(b.authVerifier);
  });

  it("derives two independent 32-byte outputs (kek ≠ authVerifier)", () => {
    const { kek, authVerifier } = deriveKeyMaterial("pw", salt);
    expect(kek).toHaveLength(KEY_BYTES);
    expect(authVerifier).toHaveLength(KEY_BYTES);
    // The §9.3 split: the value the server stores must not equal the KEK.
    expect(kek).not.toEqual(authVerifier);
  });

  it("changes both outputs when the salt changes", () => {
    const a = deriveKeyMaterial("pw", salt);
    const b = deriveKeyMaterial("pw", generateSalt());
    expect(a.kek).not.toEqual(b.kek);
    expect(a.authVerifier).not.toEqual(b.authVerifier);
  });

  it("changes both outputs when the password changes", () => {
    const a = deriveKeyMaterial("pw-one", salt);
    const b = deriveKeyMaterial("pw-two", salt);
    expect(a.kek).not.toEqual(b.kek);
    expect(a.authVerifier).not.toEqual(b.authVerifier);
  });
});

describe("generateSalt", () => {
  it("mints a fresh salt of the configured length each call", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).toHaveLength(SALT_BYTES);
    expect(a).not.toEqual(b);
  });

  it("uses an Argon2id memory cost the primitive accepts (m ≥ 8·p)", () => {
    expect(ARGON2_PARAMS.m).toBeGreaterThanOrEqual(8 * ARGON2_PARAMS.p);
  });
});
