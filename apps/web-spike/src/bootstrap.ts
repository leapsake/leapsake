import { deriveKeyMaterial, unwrapKey } from "@leapsake/crypto";
import { createHttpSyncTransport } from "@leapsake/sync";
import { eventLoopLag, timed } from "./measure.js";

/**
 * Recover an account's **master key** from a username and password, server-side,
 * holding no local store at all.
 *
 * ## Why not `joinAccount`
 *
 * `joinAccount` (`packages/key-custody/src/session.ts`) is the *device* join: it
 * needs a `KeyStore` (an OS enclave the render host does not have), it writes
 * `account` / `device` / `key_wrap` rows, and it **refuses if an account row
 * already exists**. Every one of those is wrong for a stateless renderer that
 * logs in as a different user on the next request. So the spike walks the same
 * four calls underneath it and keeps nothing:
 *
 * 1. `lookup(username)` — unauthed prelogin for the account id + public salt
 * 2. `deriveKeyMaterial(password, kdfSalt)` — one Argon2id pass, HKDF-split into
 *    the `kek` and the `authVerifier` (`packages/crypto/src/kdf.ts`)
 * 3. `fetchBootstrap({ accountId, authVerifier })` — the relay hands back
 *    `wrap(MK, kek)` ciphertext, having learned nothing
 * 4. `unwrapKey(wrappedMasterKey, kek)` — MK, in this process's memory only
 *
 * A wrong password produces a wrong verifier, so the relay 401s at step 3 and we
 * never reach an unwrap — the failure is authentication, not a decrypt error.
 *
 * ## What comes back, and why the verifier is in it
 *
 * The `authVerifier` is returned deliberately, not as a convenience. Relay
 * sessions are **in-memory per process**, so a relay restart invalidates them
 * and the caller must be able to re-login without the password. That means an
 * SSR session store has to hold the verifier, which is a standing relay
 * credential — see `session.ts` for why it must end up wrapped under the
 * session key rather than sitting in the clear beside the wrapped master key.
 */
export async function bootstrapMasterKey(opts: {
  relayUrl: string;
  username: string;
  password: string;
}): Promise<{
  accountId: string;
  masterKey: Uint8Array;
  authVerifier: Uint8Array;
  /** Argon2id wall time — the SSR host's per-login cost. */
  argon2Ms: number;
  /** Worst event-loop stall spanning the login. See `measure.ts`. */
  argon2LagMs: number;
}> {
  const { relayUrl, username, password } = opts;

  // Credential-less transport: `lookup` is the one call that precedes having any
  // credentials at all, because the salt it returns is what derives them.
  const { accountId, kdfSalt } = await createHttpSyncTransport({
    baseUrl: relayUrl,
  }).lookup(username);

  // Argon2id, measured both ways: how long it took, and how long it stalled
  // everything else. `deriveKeyMaterial` is synchronous and CPU-bound, so on a
  // single-threaded SSR host the second number is the one that matters.
  const lag = eventLoopLag();
  const { value: material, ms: argon2Ms } = await timed(async () =>
    deriveKeyMaterial(password, kdfSalt),
  );
  const argon2LagMs = await lag.stop();

  const authed = createHttpSyncTransport({
    baseUrl: relayUrl,
    accountId,
    authVerifier: material.authVerifier,
  });
  const { wrappedMasterKey } = await authed.fetchBootstrap({
    accountId,
    authVerifier: material.authVerifier,
  });

  return {
    accountId,
    masterKey: unwrapKey(wrappedMasterKey, material.kek),
    authVerifier: material.authVerifier,
    argon2Ms,
    argon2LagMs,
  };
}
