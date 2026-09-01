// The App Store Connect client is tested here because the two things it can get wrong are
// both silent and both expensive at exactly the wrong moment.
//
//   1. **The JWT.** A token Apple rejects fails as `401 NOT_AUTHORIZED`, which reads as a
//      bad key or a wrong role — not as an encoding mistake. The likeliest cause is the
//      signature format: JWS wants the raw `R‖S` pair and Node emits DER by default, and
//      the difference is invisible until Apple answers. Signing a token and verifying it
//      with the matching public key catches it here instead of after a 20-minute archive.
//   2. **The error path.** The whole point of `request()` is that Apple's `errors[].detail`
//      reaches the person running the release. A refactor that swallowed it would leave a
//      failing release saying "HTTP 409" and nothing else — and nothing would fail.
//
// Everything runs offline: the key is generated per test and `fetch` is stubbed, so this
// makes no network call and needs no credential.
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AscError, createAsc } from "./asc.mjs";

/** A throwaway P-256 key on disk, in the PKCS#8 PEM shape Apple's `.p8` files use. */
function testKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const path = join(mkdtempSync(join(tmpdir(), "asc-")), "AuthKey_TEST.p8");
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }));
  return { path, publicKey };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

/**
 * Drive a request to completion with the backoff waits collapsed.
 *
 * The delays are real seconds in a release and must not be real seconds here, so the
 * clock is faked and every pending timer run at once — which also flushes the microtasks
 * between one attempt and the next, so a chain of retries settles in a single call.
 */
async function withoutWaiting(begin) {
  vi.useFakeTimers();
  const settled = begin().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await settled;
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

/** Record the one request made, and answer with a canned response. */
function stubFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return response;
  };
  return calls;
}

const answer = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  headers: new Headers(headers),
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

/**
 * Answer differently on each call, so a retry can be watched changing its mind. Entries
 * are either a canned response to return or an `Error` to throw, in order; the last one
 * repeats once the script runs out.
 */
function stubSequence(steps) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push({ url: new URL(url), init });
    if (step instanceof Error) throw step;
    return step;
  };
  return calls;
}

/** undici's connection-level failure, in the exact shape Node throws it. */
const fetchFailed = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: new Error("ECONNRESET"),
  });

/** A client whose retries neither sleep nor print, so the tests stay fast and quiet. */
function retryingClient(onRetry = () => {}) {
  const { path } = testKey();
  return createAsc({ keyId: "K", issuerId: "I", keyPath: path, onRetry });
}

describe("the token", () => {
  it("is an ES256 JWT Apple's own rules accept", () => {
    const { path, publicKey } = testKey();
    const jwt = createAsc({
      keyId: "KEY123",
      issuerId: "issuer-uuid",
      keyPath: path,
    }).token();

    const [encodedHeader, encodedPayload, signature] = jwt.split(".");
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString(),
    );
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString(),
    );

    expect(header).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    expect(payload.iss).toBe("issuer-uuid");
    expect(payload.aud).toBe("appstoreconnect-v1");
    // Apple rejects anything over 20 minutes outright.
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(20 * 60);

    // The trap, asserted directly: a raw 64-byte R‖S signature, not DER.
    const raw = Buffer.from(signature, "base64url");
    expect(raw.length).toBe(64);
    expect(
      verify(
        "sha256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        raw,
      ),
    ).toBe(true);
  });

  it("is reused rather than re-signed on every call", () => {
    const { path } = testKey();
    const asc = createAsc({ keyId: "K", issuerId: "I", keyPath: path });
    expect(asc.token()).toBe(asc.token());
  });
});

describe("request", () => {
  it("carries the token and spells out Apple's bracketed filters", async () => {
    const { path } = testKey();
    const asc = createAsc({ keyId: "K", issuerId: "I", keyPath: path });
    const calls = stubFetch(answer(200, { data: [] }));

    await asc.get("/v1/builds", {
      query: { "filter[app]": "6001", limit: 1, "filter[skip]": undefined },
    });

    const [{ url, init }] = calls;
    expect(url.origin).toBe("https://api.appstoreconnect.apple.com");
    expect(url.pathname).toBe("/v1/builds");
    expect(url.searchParams.get("filter[app]")).toBe("6001");
    expect(url.searchParams.get("limit")).toBe("1");
    // An undefined value is omitted, not sent as the string "undefined" — which Apple
    // would answer with a filter error rather than the unfiltered list.
    expect(url.searchParams.has("filter[skip]")).toBe(false);
    expect(init.headers.authorization).toBe(`Bearer ${asc.token()}`);
  });

  it("sends a JSON body only when there is one", async () => {
    const { path } = testKey();
    const asc = createAsc({ keyId: "K", issuerId: "I", keyPath: path });
    const calls = stubFetch(answer(201, { data: { id: "1" } }));

    await asc.post("/v1/betaAppReviewSubmissions", {
      body: { data: { type: "betaAppReviewSubmissions" } },
    });

    const [{ init }] = calls;
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body).data.type).toBe("betaAppReviewSubmissions");
  });

  it("answers a 204 with nothing rather than throwing on an empty body", async () => {
    const { path } = testKey();
    const asc = createAsc({ keyId: "K", issuerId: "I", keyPath: path });
    stubFetch(answer(204, undefined));

    // Adding a build to a group answers this way, and it is the success case.
    await expect(
      asc.post("/v1/betaGroups/1/relationships/builds", {
        body: { data: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it("surfaces what Apple said, with the status and codes intact", async () => {
    const { path } = testKey();
    const asc = createAsc({ keyId: "K", issuerId: "I", keyPath: path });
    stubFetch(
      answer(409, {
        errors: [
          {
            code: "STATE_ERROR",
            title: "The request cannot be fulfilled",
            detail: "This build has already been submitted for beta review.",
          },
        ],
      }),
    );

    const error = await asc
      .post("/v1/betaAppReviewSubmissions", { body: {} })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(AscError);
    expect(error.status).toBe(409);
    expect(error.message).toContain("already been submitted for beta review");
    // `hasCode` is how the already-submitted case is told apart from a real conflict.
    expect(error.hasCode("STATE_ERROR")).toBe(true);
    expect(error.hasCode("SOMETHING_ELSE")).toBe(false);
  });

  it("still reports something when the body is not Apple's JSON at all", async () => {
    const asc = retryingClient();
    // An edge/proxy layer answering with HTML is the case this guards: `JSON.parse` would
    // throw and replace a 503 with a parse error, hiding what actually happened. A 503 is
    // also retried, so this runs on the fake clock and asserts what survives to the end.
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      headers: new Headers(),
      text: async () => "<html>upstream unavailable</html>",
    });

    const error = await withoutWaiting(() => asc.get("/v1/apps")).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(AscError);
    expect(error.status).toBe(503);
    expect(error.message).toContain("upstream unavailable");
  });
});

// The retry policy exists because of a real release: the first `pnpm release beta` archived
// and uploaded an `.ipa` successfully, then lost the entire distribute phase — notes, group,
// beta review — to a single `TypeError: fetch failed` on the call immediately after the
// upload. The recovery on offer was a fresh five-minute archive under a new build number.
// These tests pin the two halves of the judgement that prevents a repeat: what deserves
// another try, and what is a verdict to be reported rather than repeated.
describe("retrying", () => {
  it("survives a dropped connection and returns the answer that follows", async () => {
    const asc = retryingClient();
    const calls = stubSequence([
      fetchFailed(),
      answer(200, { data: [{ id: "1" }] }),
    ]);

    const body = await withoutWaiting(() =>
      asc.get("/v1/apps", {
        query: { "filter[bundleId]": "com.leapsake.app" },
      }),
    );

    expect(body.data[0].id).toBe("1");
    expect(calls).toHaveLength(2);
    // The retry is the same request, not a degraded one.
    expect(calls[1].url.searchParams.get("filter[bundleId]")).toBe(
      "com.leapsake.app",
    );
  });

  it("retries a write, because every write here is safe to repeat", async () => {
    const asc = retryingClient();
    const calls = stubSequence([fetchFailed(), answer(204, undefined)]);

    await withoutWaiting(() =>
      asc.post("/v1/betaGroups/g1/relationships/builds", {
        body: { data: [{ type: "builds", id: "b1" }] },
      }),
    );

    expect(calls).toHaveLength(2);
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(calls[1].init.body).data[0].id).toBe("b1");
  });

  it("waits out a 503, which is Apple saying 'not now'", async () => {
    const asc = retryingClient();
    const calls = stubSequence([
      answer(503, undefined),
      answer(200, { data: [] }),
    ]);

    await withoutWaiting(() => asc.get("/v1/builds"));
    expect(calls).toHaveLength(2);
  });

  it("obeys Retry-After when Apple throttles, over its own backoff", async () => {
    const asc = retryingClient();
    const calls = stubSequence([
      answer(429, { errors: [{ code: "RATE_LIMIT" }] }, { "retry-after": "3" }),
      answer(200, { data: [] }),
    ]);

    vi.useFakeTimers();
    const pending = asc.get("/v1/builds").then(
      (value) => ({ value }),
      (error) => ({ error }),
    );

    // Two seconds in, the client is still serving Apple's three — not the 1s it would
    // have chosen on its own. Asking again early is what gets a key rate-limited harder.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(1);

    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ value: { data: [] } });
    expect(calls).toHaveLength(2);
  });

  it("gives up rather than hammering, and reports what actually failed", async () => {
    const asc = retryingClient();
    const calls = stubSequence([fetchFailed()]);

    const error = await withoutWaiting(() => asc.get("/v1/apps")).catch(
      (caught) => caught,
    );

    // Four attempts total — the first plus one per backoff step.
    expect(calls).toHaveLength(4);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe("fetch failed");
  });

  it("does not repeat a verdict", async () => {
    const asc = retryingClient();
    // A wrong key role is a 403 forever; trying it four times only wastes a release.
    const calls = stubSequence([
      answer(403, {
        errors: [
          {
            code: "FORBIDDEN_ERROR",
            detail: "The given operation is not allowed",
          },
        ],
      }),
    ]);

    const error = await withoutWaiting(() => asc.get("/v1/apps")).catch(
      (caught) => caught,
    );

    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(AscError);
    expect(error.status).toBe(403);
  });

  it("says so out loud, so a paused release does not read as a hang", async () => {
    const said = [];
    const asc = retryingClient((message) => said.push(message));
    stubSequence([fetchFailed(), answer(200, { data: [] })]);

    await withoutWaiting(() => asc.get("/v1/apps"));

    expect(said).toHaveLength(1);
    expect(said[0]).toContain("GET /v1/apps");
    expect(said[0]).toContain("fetch failed");
    expect(said[0]).toContain("attempt 2 of 4");
  });
});
