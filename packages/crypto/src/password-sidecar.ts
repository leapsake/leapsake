import { SALT_BYTES, deriveKeyMaterial } from "./kdf.js";
import { unwrapKey, wrapKey } from "./wrap.js";

/**
 * The **password door** on the at-rest db-key (`model.md` §7.5 Phase 0.5) — the
 * sibling of the recovery sidecar in `recovery.ts`, and the primary one.
 *
 * An Authenticated store's db-key lives in the OS keychain, and the keychain is not
 * forever: a new machine, an OS reinstall, or the Team-ID change an org move
 * brings all lose it while the data survives. Before this, the *only* way back was
 * the 24-word phrase — so a user who remembered their password and had not written
 * the words down was locked out of data they could see on disk. This sidecar makes
 * the password open the file, and demotes the phrase to the forgot-password path.
 *
 * ### Why the salt is in the file
 *
 * Deriving the KEK needs the account's `kdfSalt`, which lives in the `account`
 * table — **inside the database this key is needed to open**. So the salt travels
 * with the sidecar or nothing can be derived at boot. Salts are public by design
 * (§7.5: the relay is given this one), so writing it beside the ciphertext costs
 * nothing: it is the *password* that is secret, and Argon2 makes guessing it slow.
 *
 * It is the account's existing salt rather than a fresh one, deliberately. One
 * password then yields one KEK, which is the same KEK that already wraps the master
 * key — one slow derivation instead of two, and one thing to keep in step when the
 * password changes rather than two. An independent salt would only pay off against
 * an attacker who learned a derived key *without* the password, which the shared
 * password caps anyway.
 *
 * ```
 * "LSKP1" ‖ salt(16) ‖ wrap(dbKey, KEK)
 * ```
 */

/**
 * Magic prefix, so the blob is self-identifying and the format can rev later.
 * `LSKP` = Leapsake Password; `1` = version 1. Distinct from the recovery
 * sidecar's `LSKR1`, so feeding one door's file to the other fails loudly on the
 * magic rather than obscurely inside the AEAD.
 */
const SIDECAR_MAGIC = Uint8Array.from([0x4c, 0x53, 0x4b, 0x50, 0x31]); // "LSKP1"

/** Where the sealed key starts: after the magic and the salt. */
const BODY_OFFSET = SIDECAR_MAGIC.length + SALT_BYTES;

/**
 * Seal the whole-DB `dbKey` under a password-derived KEK.
 *
 * Takes the KEK rather than the password on purpose: every caller is a path that
 * has *just* derived it (account creation, join, recovery, re-auth), and Argon2 is
 * deliberately expensive — re-deriving here would double the cost of each of those
 * for no gain. The `salt` must be the one the KEK was derived from; pairing a KEK
 * with the wrong salt produces a sidecar that looks written and never opens, which
 * is why callers go through `sealPasswordDoor` in `@leapsake/key-custody` rather
 * than reaching for this directly.
 */
export function sealDbKeyForPassword(opts: {
  dbKey: Uint8Array;
  kek: Uint8Array;
  salt: Uint8Array;
}): Uint8Array {
  const { dbKey, kek, salt } = opts;
  if (salt.length !== SALT_BYTES) {
    throw new Error(`Password sidecar salt must be ${SALT_BYTES} bytes.`);
  }
  const wrapped = wrapKey(dbKey, kek);
  const out = new Uint8Array(BODY_OFFSET + wrapped.length);
  out.set(SIDECAR_MAGIC, 0);
  out.set(salt, SIDECAR_MAGIC.length);
  out.set(wrapped, BODY_OFFSET);
  return out;
}

/**
 * Open the whole-DB key from a sidecar blob and the typed password, **and hand
 * back the derived key material** so a caller that needs more than the db-key does
 * not pay Argon2 twice.
 *
 * This one derives internally — unlike {@link sealDbKeyForPassword} — because only
 * the blob knows which salt to use, and at boot there is nowhere else to learn it.
 * That makes each attempt cost one Argon2 pass, which is the point: it is the same
 * work an attacker must do per guess.
 *
 * ### Why the KEK comes back out
 *
 * The salt in the blob is the *account's* salt (see the file header), so the KEK
 * this derives is the very same KEK that wraps the master key in `key_wrap`. A boot
 * that came through this door therefore already holds everything needed to unwrap
 * the account master key, and returning it lets the caller repair a device whose
 * enclave was lost with the keychain (custody slice 9) for the cost of one AEAD
 * open. Re-deriving instead would mean a second 19 MiB Argon2id pass — minutes on
 * mobile's unJITted Hermes, on the launch where the user is already waiting.
 *
 * `authVerifier` comes back for the same reason: comparing it against the account
 * row's is how a caller tells a current sidecar from a stale one, and it is free
 * here (`deriveKeyMaterial` computes both branches from the one pass).
 *
 * Throws on a bad magic, a truncated blob, or a wrong password (AEAD fails closed).
 * Callers surface all three as "that password doesn't open this database" — the
 * distinction is not useful to a user and telling them which one failed would say
 * more than it should.
 */
export function openPasswordSidecar(
  sidecar: Uint8Array,
  password: string,
): { dbKey: Uint8Array; kek: Uint8Array; authVerifier: Uint8Array } {
  const magic = sidecar.subarray(0, SIDECAR_MAGIC.length);
  if (
    sidecar.length <= BODY_OFFSET ||
    magic.length !== SIDECAR_MAGIC.length ||
    !magic.every((b, i) => b === SIDECAR_MAGIC[i])
  ) {
    throw new Error("Unrecognized password sidecar format.");
  }
  const salt = sidecar.subarray(SIDECAR_MAGIC.length, BODY_OFFSET);
  const { kek, authVerifier } = deriveKeyMaterial(password, salt);
  return {
    dbKey: unwrapKey(sidecar.subarray(BODY_OFFSET), kek),
    kek,
    authVerifier,
  };
}

/**
 * {@link openPasswordSidecar} for the callers that only want the db-key.
 */
export function openDbKeyWithPassword(
  sidecar: Uint8Array,
  password: string,
): Uint8Array {
  return openPasswordSidecar(sidecar, password).dbKey;
}
