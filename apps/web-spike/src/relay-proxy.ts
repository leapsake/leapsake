import type { IncomingMessage } from "node:http";
import type { Reply } from "./reply.js";

/**
 * `/relay/*` → `RELAY_URL/*`, so the **browser** can reach the relay at all.
 *
 * ## Why this exists, and what it must not be read as proving
 *
 * The relay sends no CORS headers and handles no `OPTIONS`, so a browser cannot
 * call it today — full stop. Increment 5b needs a client-side login, so it needs
 * a relay a browser can reach, and the two ways to get one are patching
 * `apps/server` or forwarding from the spike's own origin. This is the second,
 * for a reason the plan doc states: the relay is the component that is
 * *hardening*, and a CORS patch reverted with the spike is exactly the kind of
 * change that survives a revert by accident.
 *
 * **The real conclusion is unchanged by this file existing: the relay needs CORS
 * plus an `OPTIONS` handler (~6 lines behind a `RELAY_CORS_ORIGINS` env var)
 * before any browser client can exist.** This proxy is a spike affordance, not a
 * demonstration that no relay change is needed — see `WANTED-CHANGES.md`.
 *
 * ## Zero transport changes, which is the part worth recording
 *
 * `packages/sync/src/http-transport.ts` builds every URL by string concatenation
 * (`${base}/accounts/session`, and so on) and never `new URL(base)`, so a
 * **relative** `baseUrl: "/relay"` is legal and resolves against the page's
 * origin. Same-origin also means no preflight — which matters, because the
 * `Authorization` header the transport sends is not a CORS-safelisted one and
 * would otherwise force an `OPTIONS` the relay answers with a 404.
 *
 * ## The trust caveat, stated where the code is rather than buried in a doc
 *
 * This proxy sees `Authorization: Bearer <accountId>.<b64(authVerifier)>`. The
 * verifier is an independent HKDF branch of the KDF output, so it reveals
 * nothing about the KEK and **confidentiality genuinely survives** — a proxy
 * that logged every byte still could not read the account. What it *could* do is
 * impersonate the account to the relay: read ciphertext, and push it. That is an
 * availability and integrity dependency a production client must not have, and
 * it is why the answer is CORS rather than a permanent forwarder.
 */

export const relayUrl = process.env.RELAY_URL ?? "http://localhost:4000";

/** Buffer a request body, for the POSTs (`/sync/push`, `/accounts/session`). */
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Forward one request. `target` is the path *after* `/relay`, query string
 * included.
 *
 * Only two request headers cross: `authorization`, which is the whole point, and
 * `content-type`, which the relay's body parsing needs. Nothing else is
 * forwarded — a header this does not name cannot be a variable in whether the
 * browser path works, which is what makes a green result here mean something.
 */
export async function proxyRelay(
  req: IncomingMessage,
  target: string,
): Promise<Reply> {
  const method = req.method ?? "GET";
  const headers: Record<string, string> = {};
  const { authorization, "content-type": contentType } = req.headers;
  if (authorization !== undefined) headers.authorization = authorization;
  if (contentType !== undefined) headers["content-type"] = contentType;

  const res = await fetch(`${relayUrl}${target}`, {
    method,
    headers,
    body: await readBody(req),
  });
  const body = await res.text();

  return {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
    body,
  };
}
