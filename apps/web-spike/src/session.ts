import { randomUUID } from "node:crypto";
import { base64ToBytes, bytesToBase64 } from "@leapsake/bytes";
import { generateKey, unwrapKey, wrapKey } from "@leapsake/crypto";
import { bootstrapMasterKey } from "./bootstrap.js";

/**
 * The **split session key** of `plans/encryption/model.md` §9.2 Scenario 1, built
 * rather than faked.
 *
 * The spike doc insists on this over a plaintext `Map<sessionId, masterKey>`, and
 * the insistence pays for itself twice over — both of the things a map would have
 * hidden are visible in the thirty lines below.
 *
 * ## The shape
 *
 * At login: derive the master key from username + password (four calls, see
 * `bootstrap.ts`), mint a random **session key** `sk`, keep `wrap(MK, sk)` on the
 * server, and hand `sk` to the browser in an `httpOnly` cookie. Per request:
 * unwrap into request-scoped memory, render, zeroize. The server's own store is
 * therefore inert — a thief who takes it holds ciphertext under keys that only
 * exist in live browsers' cookie jars.
 *
 * ## What building it surfaced
 *
 * 1. **The `authVerifier` has to live here too, and it is a standing relay
 *    credential.** Relay sessions are in-memory per process, so a relay restart
 *    invalidates them and the host must be able to re-authenticate without the
 *    password. Held in the clear beside the wrapped MK, it partly defeats the
 *    split: a store thief gets a credential good for reading and writing all of
 *    the account's ciphertext. So it is wrapped under the same `sk` — one extra
 *    line, and a genuine refinement §9.2 does not currently spell out.
 * 2. **A warm decrypted store defeats the split entirely** — see `hydrate.ts`,
 *    which is where that measurement lives.
 *
 * ## What is deliberately missing
 *
 * No expiry sweep, no rotation, no CSRF token, no `Secure` flag (the spike runs
 * on `http://localhost`, which is a secure context but not TLS). Each is real
 * work for a real client and none of it changes an answer the spike is after.
 */

/** Server-side half: ciphertext only, useless without the browser's cookie. */
interface SessionRecord {
  accountId: string;
  username: string;
  /** `wrap(masterKey, sk)`. */
  wrappedMasterKey: Uint8Array;
  /** `wrap(authVerifier, sk)` — see the docblock; not stored in the clear. */
  wrappedAuthVerifier: Uint8Array;
  relayUrl: string;
  createdAt: number;
  /**
   * The push high-water mark, which lives **here** because a cold store has
   * nowhere else to put it (Increment 3).
   *
   * Desktop and mobile keep this in a `sync_state` row, and `SyncEngine.pushAndPull`
   * reads it from there. A cold host cannot: the row would be written into a
   * database that is discarded at the end of the request, so every write would
   * start from zero. Session-scoped is the natural home — it is per-account,
   * outlives the request, and is not a secret, so it needs no wrapping.
   *
   * What it costs is stated rather than hidden: it starts at 0, so a session's
   * **first** write re-seals and re-pushes the whole store. The relay LWW-merges
   * that to a no-op, so it is a cost rather than a bug, and the README reports
   * what it is.
   */
  pushHwm: number;
}

/** A session opened for the duration of one request. */
export interface OpenSession {
  id: string;
  accountId: string;
  username: string;
  relayUrl: string;
  masterKey: Uint8Array;
  authVerifier: Uint8Array;
  /** Where the next push starts from; see {@link SessionRecord.pushHwm}. */
  pushHwm: number;
  /** Zeroize the request-scoped copies. §9.2's "memory-only, request-scoped". */
  close(): void;
}

const sessions = new Map<string, SessionRecord>();

export const COOKIE_NAME = "ls_session";

/**
 * `bytesToBase64` emits **standard** base64, whose `+` and `/` are not safe in a
 * cookie value or a URL fragment. Both this and Increment 4's capability links
 * need the URL alphabet, so the conversion lives here rather than being written
 * twice.
 */
function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const standard = text.replaceAll("-", "+").replaceAll("_", "/");
  return base64ToBytes(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
}

/**
 * Log in: username + password → a session, and a `Set-Cookie` carrying nothing
 * but the session id and its key.
 *
 * The Argon2id numbers come back with it because this is the **only** place the
 * KDF runs per session — the whole point of the warm-key configuration
 * `hydrate.ts` measures. Every later request in the session pays zero of it.
 */
export async function openSession(opts: {
  relayUrl: string;
  username: string;
  password: string;
}): Promise<{ cookie: string; argon2Ms: number; argon2LagMs: number }> {
  const { accountId, masterKey, authVerifier, argon2Ms, argon2LagMs } =
    await bootstrapMasterKey(opts);

  const sessionKey = generateKey();
  const id = randomUUID();
  sessions.set(id, {
    accountId,
    username: opts.username,
    wrappedMasterKey: wrapKey(masterKey, sessionKey),
    wrappedAuthVerifier: wrapKey(authVerifier, sessionKey),
    relayUrl: opts.relayUrl,
    createdAt: Date.now(),
    pushHwm: 0,
  });
  // The plaintext key material never reaches the map, and the login's own copies
  // die with this call frame.
  masterKey.fill(0);
  authVerifier.fill(0);

  return {
    // `SameSite=Lax` still sends the cookie on a top-level GET navigation, which
    // is every no-JS page load. No `Secure`: this is plain `http://localhost`.
    cookie: `${COOKIE_NAME}=${id}.${toBase64Url(sessionKey)}; HttpOnly; SameSite=Lax; Path=/`,
    argon2Ms,
    argon2LagMs,
  };
}

/** Read one cookie out of a raw `Cookie:` header. */
function readCookie(header: string | undefined, name: string): string | null {
  for (const pair of header?.split(";") ?? []) {
    const at = pair.indexOf("=");
    if (at !== -1 && pair.slice(0, at).trim() === name) {
      return pair.slice(at + 1).trim();
    }
  }
  return null;
}

/**
 * Resolve the request's cookie into decrypted key material, for this request
 * only. `null` for no cookie, an unknown session, or a key that does not unwrap
 * — all three are "log in again", and telling them apart would only tell an
 * attacker which half they guessed.
 */
export function resolveSession(
  cookieHeader: string | undefined,
): OpenSession | null {
  const raw = readCookie(cookieHeader, COOKIE_NAME);
  if (raw === null) return null;

  const dot = raw.indexOf(".");
  if (dot === -1) return null;
  const record = sessions.get(raw.slice(0, dot));
  if (record === undefined) return null;

  try {
    const sessionKey = fromBase64Url(raw.slice(dot + 1));
    // AEAD, so a wrong key throws here rather than yielding garbage — the
    // authentication is the check, and there is nothing else to verify.
    const masterKey = unwrapKey(record.wrappedMasterKey, sessionKey);
    const authVerifier = unwrapKey(record.wrappedAuthVerifier, sessionKey);
    return {
      id: raw.slice(0, dot),
      accountId: record.accountId,
      username: record.username,
      relayUrl: record.relayUrl,
      masterKey,
      authVerifier,
      pushHwm: record.pushHwm,
      close: () => {
        masterKey.fill(0);
        authVerifier.fill(0);
      },
    };
  } catch {
    return null;
  }
}

/** Advance where the next push starts from, after one has landed. */
export function setPushHwm(id: string, hwm: number): void {
  const record = sessions.get(id);
  if (record !== undefined) record.pushHwm = hwm;
}

/** Drop the server's half; the cookie it matched becomes inert. */
export function closeSession(id: string): void {
  sessions.delete(id);
}

/** Expire the cookie — the `Set-Cookie` a logout responds with. */
export const CLEAR_COOKIE = `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
