import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { base64ToBytes } from "@leapsake/crypto";
import { decodeRecord, encodeRecord } from "@leapsake/data";
import { z } from "zod";
import type { RelayStore } from "./store.js";

/**
 * The blind relay — `sync.md` §2's "least clever option": an authenticated
 * HTTPS endpoint that stores and serves opaque {@link WireRecord}s ordered by an
 * opaque cursor. It can read, merge, and order *nothing* about content; it only
 * orders *delivery*. Three routes:
 *
 * - `POST /accounts`  — register `{ accountId, authVerifier, kdfSalt }` (b64).
 * - `POST /sync/push` — auth required; append `{ records }` to the account log.
 * - `GET  /sync/pull` — auth required; `?since=<cursor>` → `{ records, cursor }`.
 *
 * Auth is `Authorization: Bearer <accountId>.<base64(authVerifier)>`. The relay
 * stores only `sha256(verifier)` and constant-time-compares (model.md §9.3); a
 * device may only ever touch its own namespace, taken from the authenticated
 * identity — never from the request body.
 */

// --- Trust-boundary validation (AGENTS.md: Zod at every boundary). ----------

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, "expected base64");

const registerBodySchema = z.object({
  accountId: z.uuid(),
  authVerifier: base64,
  kdfSalt: base64,
});

const wireRecordSchema = z.object({
  id: z.string(),
  table: z.string(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
  ciphertext: base64,
  wrappedKey: base64.optional(),
});

const pushBodySchema = z.object({ records: z.array(wireRecordSchema) });

// --- Helpers. ---------------------------------------------------------------

function sha256(input: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(input).digest());
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

/**
 * Authenticate the bearer token against the relay's stored verifier hash.
 * Returns the authenticated account id, or `null` on any failure (no account,
 * malformed token, verifier mismatch) — the caller answers 401 either way.
 */
function authenticate(req: IncomingMessage, store: RelayStore): string | null {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);

  // Split on the first `.`: the account UUID has none, and base64 produces none.
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const accountId = token.slice(0, dot);
  const verifierB64 = token.slice(dot + 1);

  const account = store.getAccount(accountId);
  if (account === undefined) return null;

  let presented: Uint8Array;
  try {
    presented = base64ToBytes(verifierB64);
  } catch {
    return null;
  }
  const presentedHash = sha256(presented);
  if (presentedHash.length !== account.authVerifierHash.length) return null;
  if (!timingSafeEqual(presentedHash, account.authVerifierHash)) return null;

  return accountId;
}

// --- The server. ------------------------------------------------------------

export function createRelayServer(opts: { store: RelayStore }): Server {
  const { store } = opts;

  return createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
    });
  });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://relay");
    const { method } = req;

    if (method === "POST" && url.pathname === "/accounts") {
      const parsed = registerBodySchema.safeParse(
        JSON.parse((await readBody(req)) || "{}"),
      );
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }
      const { accountId, authVerifier, kdfSalt } = parsed.data;
      store.registerAccount(
        accountId,
        sha256(base64ToBytes(authVerifier)),
        base64ToBytes(kdfSalt),
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/sync/push") {
      const accountId = authenticate(req, store);
      if (accountId === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const parsed = pushBodySchema.safeParse(
        JSON.parse((await readBody(req)) || "{}"),
      );
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }
      // The account is the *authenticated* identity, never the body — a device
      // can only ever push into its own namespace.
      store.append(accountId, parsed.data.records.map(decodeRecord));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/sync/pull") {
      const accountId = authenticate(req, store);
      if (accountId === null) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const since = Number(url.searchParams.get("since") ?? "0");
      if (!Number.isFinite(since) || since < 0) {
        sendJson(res, 400, { error: "invalid cursor" });
        return;
      }
      const { records, cursor } = store.pull(accountId, since);
      sendJson(res, 200, { records: records.map(encodeRecord), cursor });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  }
}
