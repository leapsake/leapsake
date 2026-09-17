// The Play client is tested for the things that fail silently and expensively.
//
//   1. **The assertion.** A token Google rejects fails as `401 invalid_grant`, which reads
//      as a revoked key rather than a malformed claim set. Signing one and verifying it
//      with the matching public key catches it here.
//   2. **The error path.** Google's `error.message` names the actual problem ("Version
//      code 368157 has already been used"); a refactor that swallowed it would leave a
//      failing release saying "HTTP 403".
//   3. **The edit lifecycle.** An edit that commits after a failed upload would publish a
//      half-built release; one that is never abandoned leaks. Neither shows up in a
//      unit-less world until a real release does it.
//
// Everything runs offline: the key is generated per test and `fetch` is stubbed.
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlayError, createPlay } from "./play.mjs";

const PKG = "com.leapsake.app";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** A throwaway service-account JSON on disk, in the shape Google hands out. */
function testCredentials() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const path = join(mkdtempSync(join(tmpdir(), "play-")), "credentials.json");
  writeFileSync(
    path,
    JSON.stringify({
      type: "service_account",
      project_id: "leapsake-test",
      private_key_id: "KEYID",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
      client_email: "releaser@leapsake-test.iam.gserviceaccount.com",
    }),
  );
  return { path, publicKey };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

const answer = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  headers: new Headers(headers),
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

const TOKEN_OK = () =>
  answer(200, { access_token: "ya29.test", expires_in: 3600 });

/**
 * Stub `fetch`, answering the token endpoint automatically and the API from `steps`.
 *
 * Entries are a canned response or an `Error` to throw, in order; the last repeats. Only
 * API calls are recorded, so a test never has to account for token traffic.
 */
function stubApi(steps) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.href === TOKEN_URL) return TOKEN_OK();
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push({ url: parsed, init });
    if (step instanceof Error) throw step;
    return step;
  };
  return calls;
}

/** Drive a request to completion with the backoff waits collapsed. */
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

const quiet = () => {};

describe("authentication", () => {
  it("signs an RS256 assertion the matching public key verifies", async () => {
    const { path, publicKey } = testCredentials();
    let assertion;
    globalThis.fetch = async (url, init) => {
      assertion = new URLSearchParams(init.body).get("assertion");
      return TOKEN_OK();
    };

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    await play.token();

    const [header, payload, signature] = assertion.split(".");
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);

    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    expect(claims.aud).toBe(TOKEN_URL);
    expect(claims.scope).toBe(
      "https://www.googleapis.com/auth/androidpublisher",
    );
    expect(claims.iss).toBe("releaser@leapsake-test.iam.gserviceaccount.com");
    // Google rejects an assertion living longer than an hour.
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
  });

  it("exchanges the assertion once and reuses the access token", async () => {
    const { path } = testCredentials();
    let exchanges = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).href === TOKEN_URL) {
        exchanges++;
        return TOKEN_OK();
      }
      return answer(200, {});
    };

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    await play.get(`${play.app(PKG)}/edits/1/tracks`);
    await play.get(`${play.app(PKG)}/edits/1/tracks`);

    expect(exchanges).toBe(1);
  });

  it("sends the access token as a bearer on API calls", async () => {
    const { path } = testCredentials();
    const calls = stubApi([answer(200, {})]);

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    await play.get(`${play.app(PKG)}/edits/1/tracks`);

    expect(calls[0].init.headers.authorization).toBe("Bearer ya29.test");
  });

  it("explains a rejected key with Google's own wording", async () => {
    const { path } = testCredentials();
    globalThis.fetch = async () =>
      answer(400, {
        error: "invalid_grant",
        error_description: "Invalid JWT Signature.",
      });

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    await expect(play.token()).rejects.toThrow(
      /invalid_grant: Invalid JWT Signature/,
    );
  });

  it("refuses a JSON file that is not a service-account key", () => {
    const path = join(mkdtempSync(join(tmpdir(), "play-")), "credentials.json");
    writeFileSync(path, JSON.stringify({ installed: { client_id: "x" } }));

    expect(() => createPlay({ credentialsPath: path })).toThrow(
      /missing "client_email"/,
    );
  });
});

describe("the error path", () => {
  it("surfaces Google's error message rather than the status alone", async () => {
    const { path } = testCredentials();
    stubApi([
      answer(403, {
        error: {
          code: 403,
          message: "Version code 368157 has already been used.",
          status: "PERMISSION_DENIED",
          errors: [{ reason: "apkUpgradeVersionConflict" }],
        },
      }),
    ]);

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    const failure = await play
      .get(`${play.app(PKG)}/edits/1/tracks`)
      .catch((error) => error);

    expect(failure).toBeInstanceOf(PlayError);
    expect(failure.message).toMatch(
      /Version code 368157 has already been used/,
    );
    expect(failure.status).toBe(403);
    expect(failure.hasReason("apkUpgradeVersionConflict")).toBe(true);
  });
});

describe("retrying", () => {
  it("retries a 5xx and returns the eventual success", async () => {
    const { path } = testCredentials();
    const calls = stubApi([answer(503), answer(200, { id: "edit-1" })]);

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    const result = await withoutWaiting(() =>
      play.post(`${play.app(PKG)}/edits`),
    );

    expect(result).toEqual({ id: "edit-1" });
    expect(calls).toHaveLength(2);
  });

  it("does not retry a verdict", async () => {
    const { path } = testCredentials();
    const calls = stubApi([answer(403, { error: { message: "denied" } })]);

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    await expect(
      withoutWaiting(() => play.post(`${play.app(PKG)}/edits`)),
    ).rejects.toThrow(/denied/);

    expect(calls).toHaveLength(1);
  });

  it("does not retry a bundle upload — its recovery is a fresh edit", async () => {
    const { path } = testCredentials();
    const aab = join(mkdtempSync(join(tmpdir(), "play-")), "app-release.aab");
    writeFileSync(aab, "not really a bundle");
    const calls = stubApi([new TypeError("fetch failed")]);

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    await expect(
      withoutWaiting(() => play.uploadBundle(PKG, "edit-1", aab)),
    ).rejects.toThrow(/fetch failed/);

    expect(calls).toHaveLength(1);
  });
});

describe("uploading a bundle", () => {
  it("posts octet-stream to the upload host with uploadType=media", async () => {
    const { path } = testCredentials();
    const aab = join(mkdtempSync(join(tmpdir(), "play-")), "app-release.aab");
    writeFileSync(aab, "not really a bundle");
    const calls = stubApi([answer(200, { versionCode: 371753 })]);

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    const bundle = await play.uploadBundle(PKG, "edit-1", aab);

    expect(bundle.versionCode).toBe(371753);
    const { url, init } = calls[0];
    expect(url.pathname).toBe(
      `/upload/androidpublisher/v3/applications/${PKG}/edits/edit-1/bundles`,
    );
    expect(url.searchParams.get("uploadType")).toBe("media");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/octet-stream");
    expect(Buffer.from(init.body).toString()).toBe("not really a bundle");
  });
});

describe("the edit lifecycle", () => {
  /** Answer by route, so a lifecycle test reads as the calls it expects. */
  function stubRoutes() {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(url);
      if (parsed.href === TOKEN_URL) return TOKEN_OK();
      calls.push(`${init.method} ${parsed.pathname}`);
      return answer(200, { id: "edit-1" });
    };
    return calls;
  }

  it("commits the edit when the body succeeds", async () => {
    const { path } = testCredentials();
    const calls = stubRoutes();

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    const result = await play.withEdit(PKG, async (editId) => `did ${editId}`);

    expect(result).toBe("did edit-1");
    expect(calls).toEqual([
      `POST /androidpublisher/v3/applications/${PKG}/edits`,
      `POST /androidpublisher/v3/applications/${PKG}/edits/edit-1:commit`,
    ]);
  });

  it("abandons rather than commits when the body throws", async () => {
    const { path } = testCredentials();
    const calls = stubRoutes();

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    await expect(
      play.withEdit(PKG, async () => {
        throw new Error("the upload failed");
      }),
    ).rejects.toThrow(/the upload failed/);

    expect(calls).toEqual([
      `POST /androidpublisher/v3/applications/${PKG}/edits`,
      `DELETE /androidpublisher/v3/applications/${PKG}/edits/edit-1`,
    ]);
    expect(calls.some((call) => call.includes(":commit"))).toBe(false);
  });

  it("abandons without committing when asked not to commit", async () => {
    const { path } = testCredentials();
    const calls = stubRoutes();

    const play = createPlay({ credentialsPath: path, onRetry: quiet });
    await play.withEdit(PKG, async () => "dry run", { commit: false });

    expect(calls).toEqual([
      `POST /androidpublisher/v3/applications/${PKG}/edits`,
      `DELETE /androidpublisher/v3/applications/${PKG}/edits/edit-1`,
    ]);
  });

  it("reports a failed abandon without masking the original failure", async () => {
    const { path } = testCredentials();
    const notices = [];
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(url);
      if (parsed.href === TOKEN_URL) return TOKEN_OK();
      if (init.method === "DELETE") return answer(500, {});
      return answer(200, { id: "edit-1" });
    };

    const play = createPlay({
      credentialsPath: path,
      onRetry: (message) => notices.push(message),
    });
    await expect(
      withoutWaiting(() =>
        play.withEdit(PKG, async () => {
          throw new Error("the upload failed");
        }),
      ),
    ).rejects.toThrow(/the upload failed/);

    expect(notices.some((note) => note.includes("was left open"))).toBe(true);
  });
});
