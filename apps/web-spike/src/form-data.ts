import type { IncomingMessage } from "node:http";

/**
 * A posted form body → `URLSearchParams`.
 *
 * `application/x-www-form-urlencoded` is what a browser sends when no JavaScript
 * intercepts the submit, and `URLSearchParams` parses exactly that — including
 * repeated names, which is how the shared forms express multi-value fields. So
 * the no-JS write path needs no body parser and no dependency.
 *
 * Increment 3 grows this file with the field readers (`readPersonInput`,
 * `readGender`, `readTags`) ported from the desktop router; Increment 2 needs
 * only the login form, so only the body reader exists yet.
 */
export async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  // The same unbounded accumulation the relay's `readBody` does, and worth
  // naming rather than fixing here: a real host caps this, because an
  // unauthenticated POST that streams forever is a free denial of service.
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
