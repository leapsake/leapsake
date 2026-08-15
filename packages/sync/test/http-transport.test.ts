import { bytesToBase64 } from "@leapsake/bytes";
import { describe, expect, it } from "vitest";
import { createHttpSyncTransport } from "../src/http-transport.js";

/**
 * The session lifecycle the HTTP transport manages *itself* (threat H3,
 * `apps/server/README.md`): it exchanges the durable verifier for a short-lived token at
 * `POST /accounts/session` once, carries that token on the hot `push`/`pull` path,
 * and re-logs-in transparently on a 401 — so the verifier transits once per login,
 * never per request, and everything above the transport stays unchanged. Driven by
 * an injected `fetch` so expiry/invalidation are deterministic (no real clock).
 */

const ACCOUNT_ID = crypto.randomUUID();
const AUTH_VERIFIER = new Uint8Array(32).fill(1);
const VERIFIER_B64 = bytesToBase64(AUTH_VERIFIER);

/** A 200 JSON response. */
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A tiny stand-in relay: verifier→session at the login route, session on the hot path. */
function mockRelay(opts?: { verifierOk?: () => boolean }) {
  const calls = { login: 0, push: 0, pull: 0 };
  const loginAuths: string[] = [];
  const hotAuths: string[] = [];
  let token = "";

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers.authorization ?? "";

    if (url.endsWith("/accounts/session")) {
      calls.login += 1;
      loginAuths.push(auth);
      if (!auth.startsWith("Bearer ") || !(opts?.verifierOk?.() ?? true)) {
        return new Response("", { status: 401 });
      }
      token = `session-token-${calls.login}`;
      return ok({ token, expiresAt: Date.now() + 3_600_000 });
    }

    // Hot path: a live `Session <token>` is required; anything else is a 401.
    hotAuths.push(auth);
    if (auth !== `Session ${token}` || token === "") {
      return new Response("", { status: 401 });
    }
    if (url.includes("/sync/push")) {
      calls.push += 1;
      return ok({ ok: true });
    }
    if (url.includes("/sync/pull")) {
      calls.pull += 1;
      return ok({ records: [], cursor: 0 });
    }
    return new Response("", { status: 404 });
  };

  /** Simulate a relay restart / server-side expiry: existing tokens stop working. */
  const invalidateSessions = () => {
    token = "";
  };
  return { fetchImpl, calls, loginAuths, hotAuths, invalidateSessions };
}

function transportWith(fetchImpl: typeof fetch) {
  return createHttpSyncTransport({
    baseUrl: "https://relay.example",
    accountId: ACCOUNT_ID,
    authVerifier: AUTH_VERIFIER,
    fetch: fetchImpl,
  });
}

describe("HttpSyncTransport sessions", () => {
  it("logs in once, then reuses the session across many hot-path calls", async () => {
    const relay = mockRelay();
    const t = transportWith(relay.fetchImpl);

    await t.push([]);
    await t.pull(0);
    await t.push([]);

    expect(relay.calls.login).toBe(1); // verifier sent exactly once
    expect(relay.calls.push).toBe(2);
    expect(relay.calls.pull).toBe(1);
  });

  it("carries the Session scheme on the hot path, never the raw verifier", async () => {
    const relay = mockRelay();
    const t = transportWith(relay.fetchImpl);

    await t.pull(0);

    // The verifier appears only in the one-time login Bearer…
    expect(relay.loginAuths).toEqual([`Bearer ${ACCOUNT_ID}.${VERIFIER_B64}`]);
    // …and never on the hot path, which uses an opaque session token.
    for (const auth of relay.hotAuths) {
      expect(auth.startsWith("Session ")).toBe(true);
      expect(auth).not.toContain(VERIFIER_B64);
    }
  });

  it("re-logs-in once and retries after a session is invalidated (relay restart)", async () => {
    const relay = mockRelay();
    const t = transportWith(relay.fetchImpl);

    await t.push([]); // login #1, session cached
    relay.invalidateSessions(); // e.g. the relay restarted and lost its sessions
    await t.pull(0); // hot 401 → re-login #2 → retry succeeds

    expect(relay.calls.login).toBe(2);
    expect(relay.calls.pull).toBe(1); // only the successful retry counted
  });

  it("propagates a 401 when the re-login itself fails (stale verifier = password reset elsewhere)", async () => {
    let verifierOk = true;
    const relay = mockRelay({ verifierOk: () => verifierOk });
    const t = transportWith(relay.fetchImpl);

    await t.push([]); // succeeds while the verifier is still valid
    relay.invalidateSessions();
    verifierOk = false; // the password was reset on another device

    // Hot 401 → re-login → login 401 → surfaced as a 401 (isRelayAuthError's signal).
    await expect(t.pull(0)).rejects.toThrow(/401/);
  });

  it("throws when built without credentials (nothing to log in with)", async () => {
    const relay = mockRelay();
    const t = createHttpSyncTransport({
      baseUrl: "https://relay.example",
      fetch: relay.fetchImpl,
    });
    await expect(t.push([])).rejects.toThrow(/no credentials/);
    expect(relay.calls.login).toBe(0);
  });
});
