import { bytesToBase64 } from "@leapsake/bytes";
import { describe, expect, it } from "vitest";
import { lookupAccount } from "../src/sync.js";

/**
 * The prelogin existence probe behind the combined sign-up / log-in flow: a hit
 * is `true`, the relay's 404 miss is `false`, and a connection failure (or any
 * unexpected status) propagates so the UI can tell "no such account" apart from
 * "couldn't reach the relay".
 */
const args = { relayUrl: "https://relay.example", username: "ada" };

/** Relay says the username is known: a JSON body with the account id + salt. */
const hitFetch: typeof fetch = async () =>
  new Response(
    JSON.stringify({
      accountId: crypto.randomUUID(),
      kdfSalt: bytesToBase64(new Uint8Array(16)),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

/** Relay's miss for an unknown username. */
const missFetch: typeof fetch = async () => new Response("", { status: 404 });

/** The relay is unreachable — `fetch` itself rejects. */
const unreachableFetch: typeof fetch = async () => {
  throw new TypeError("fetch failed");
};

describe("lookupAccount", () => {
  it("returns true when the relay knows the username", async () => {
    expect(await lookupAccount({ ...args, fetch: hitFetch })).toBe(true);
  });

  it("returns false on the relay's 404 miss", async () => {
    expect(await lookupAccount({ ...args, fetch: missFetch })).toBe(false);
  });

  it("propagates a connection failure (so it isn't read as 'no account')", async () => {
    await expect(
      lookupAccount({ ...args, fetch: unreachableFetch }),
    ).rejects.toThrow(/fetch failed/);
  });
});
