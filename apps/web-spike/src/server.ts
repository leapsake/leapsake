import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createViteServer } from "vite";
import type { Reply } from "./reply.js";

/**
 * The spike's HTTP host: a bare `node:http` server with Vite in **middleware
 * mode** underneath it.
 *
 * Bare on purpose. The framework question (Remix / Next / React Router) is
 * deliberately still open, and the spike must not settle it by accident — its job
 * is to measure what *any* framework would have to carry. So the routing is a
 * `switch` on method + pathname, and it lives in `app.tsx`.
 *
 * ```sh
 * pnpm --filter @leapsake/web-spike dev
 * ```
 *
 * **This file holds no application state and imports no route.** It reaches
 * `app.tsx` only through `vite.ssrLoadModule`, which keeps the entire app in one
 * module graph — see `app.tsx` for why two graphs would silently split the
 * session store in half.
 */

const port = Number(process.env.PORT ?? 5180);

// Middleware mode: Vite transforms modules on request and never binds a port of
// its own, so one origin covers SSR pages, the client bundle, the `.wasm`, and
// the relay proxy Increment 5 needs.
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});

function send(res: ServerResponse, reply: Reply): void {
  res.writeHead(reply.status, {
    "content-type": "text/plain; charset=utf-8",
    // §9.2 asks for it, and it is a header. Everything this host renders is
    // decrypted user data that must never land in a shared cache — and `private`
    // alone would still let the *browser* keep it, which is why it is `no-store`.
    "cache-control": "private, no-store",
    ...reply.headers,
  });
  res.end(reply.body);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = (await vite.ssrLoadModule("/src/app.tsx")) as {
    handleRequest: (req: IncomingMessage) => Promise<Reply>;
  };
  send(res, await app.handleRequest(req));
}

createServer((req, res) => {
  // Vite's middleware first: it owns `/@vite/*`, `/@fs/*`, and every transformed
  // module URL. `next()` falls through to our routes, so `app.tsx` only ever sees
  // requests Vite did not claim.
  vite.middlewares(req, res, () => {
    handle(req, res).catch((error: unknown) => {
      // `ssrFixStacktrace` maps the transformed stack back to source lines;
      // without it every SSR error points at generated code.
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      console.error(error);
      send(res, { status: 500, body: `${error}\n` });
    });
  });
}).listen(port, async () => {
  const { bootBanner } = (await vite.ssrLoadModule("/src/app.tsx")) as {
    bootBanner: string;
  };
  console.log(`web-spike listening on http://localhost:${port}  (${bootBanner})`);
});
