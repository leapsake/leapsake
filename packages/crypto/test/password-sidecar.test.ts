import { describe, expect, it } from "vitest";
import { SALT_BYTES, deriveKeyMaterial, generateSalt } from "../src/kdf.js";
import { generateKey } from "../src/keys.js";
import {
  openDbKeyWithPassword,
  sealDbKeyForPassword,
} from "../src/password-sidecar.js";
import { sealDbKeyForRecovery } from "../src/recovery.js";

const PASSWORD = "correct horse battery staple";

/** Seal a db-key the way every real caller does: derive, then seal under the pair. */
function sidecarFor(password: string, dbKey: Uint8Array) {
  const salt = generateSalt();
  const { kek } = deriveKeyMaterial(password, salt);
  return sealDbKeyForPassword({ dbKey, kek, salt });
}

describe("sealDbKeyForPassword / openDbKeyWithPassword", () => {
  it("round-trips the db-key under the password alone", () => {
    const dbKey = generateKey();
    // The salt is never handed to the opener — it rides in the blob, which is the
    // whole reason this door works before the database (and its salt) can open.
    expect(
      openDbKeyWithPassword(sidecarFor(PASSWORD, dbKey), PASSWORD),
    ).toEqual(dbKey);
  });

  it("rejects a wrong password", () => {
    const sidecar = sidecarFor(PASSWORD, generateKey());
    expect(() =>
      openDbKeyWithPassword(sidecar, "wrong password entirely"),
    ).toThrow();
  });

  it("leaves the sidecar usable after a wrong-password attempt", () => {
    // The loop-until-correct gate depends on this: a failed try must consume
    // nothing, or the second attempt fails for a different reason than the first.
    const dbKey = generateKey();
    const sidecar = sidecarFor(PASSWORD, dbKey);
    expect(() => openDbKeyWithPassword(sidecar, "nope")).toThrow();
    expect(openDbKeyWithPassword(sidecar, PASSWORD)).toEqual(dbKey);
  });

  it("carries its own salt, so two sidecars for one password differ", () => {
    const dbKey = generateKey();
    const a = sidecarFor(PASSWORD, dbKey);
    const b = sidecarFor(PASSWORD, dbKey);
    expect(a).not.toEqual(b);
    expect(openDbKeyWithPassword(a, PASSWORD)).toEqual(dbKey);
    expect(openDbKeyWithPassword(b, PASSWORD)).toEqual(dbKey);
  });

  it("rejects a recovery sidecar rather than failing obscurely inside the AEAD", () => {
    // The two doors sit side by side on disk; handing one to the other should fail
    // on the magic with a format error, not somewhere deep in a decrypt.
    const recovery = sealDbKeyForRecovery(generateKey(), generateKey());
    expect(() => openDbKeyWithPassword(recovery, PASSWORD)).toThrow(
      /sidecar format/,
    );
  });

  it("rejects a blob too short to hold magic + salt + body", () => {
    expect(() => openDbKeyWithPassword(new Uint8Array(8), PASSWORD)).toThrow(
      /sidecar format/,
    );
  });

  it("refuses to seal under a salt of the wrong length", () => {
    // A short salt would silently produce a sidecar nothing could open, since the
    // opener slices a fixed SALT_BYTES back out.
    expect(() =>
      sealDbKeyForPassword({
        dbKey: generateKey(),
        kek: generateKey(),
        salt: new Uint8Array(SALT_BYTES - 1),
      }),
    ).toThrow(/salt/);
  });

  it("stores neither the password nor the KEK in the clear", () => {
    const dbKey = generateKey();
    const salt = generateSalt();
    const { kek } = deriveKeyMaterial(PASSWORD, salt);
    const sidecar = sealDbKeyForPassword({ dbKey, kek, salt });

    const hex = Buffer.from(sidecar).toString("hex");
    expect(hex).not.toContain(Buffer.from(kek).toString("hex"));
    expect(hex).not.toContain(Buffer.from(dbKey).toString("hex"));
    expect(Buffer.from(sidecar).toString("latin1")).not.toContain(PASSWORD);
    // The salt is the one thing that *is* public, and must be, or the boot path
    // has nothing to derive from.
    expect(hex).toContain(Buffer.from(salt).toString("hex"));
  });
});
