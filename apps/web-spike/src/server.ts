import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createViteServer } from "vite";

/**
 * The spike's HTTP host: a bare `node:http` server with Vite in **middleware
 * mode** underneath it.
 *
 * Bare on purpose. The framework question (Remix / Next / React Router) is
 * deliberately still open, and the spike must not settle it by accident — its job
 * is to measure what *any* framework would have to carry. So this is a `switch`
 * on method + pathname, mirroring `apps/server/src/relay.ts`'s handler, and it
 * stays that way through Increment 4.
 *
 * ```sh
 * pnpm --filter @leapsake/web-spike dev
 * ```
 *
 * Increment 1 serves two routes; Increments 2-4 add the real ones beside them.
 */

const port = Number(process.env.PORT ?? 5180);

// Middleware mode: Vite transforms modules on request and never binds a port of
// its own, so one origin covers SSR pages, the client bundle, the `.wasm`, and
// the relay proxy Increment 5 needs.
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    // §9.2 asks for it, and it is a header. Everything this host renders is
    // decrypted user data that must never land in a shared cache.
    "cache-control": "private, no-store",
  });
  res.end(body);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://web-spike");
  const { method } = req;

  if (method === "GET" && url.pathname === "/health") {
    sendText(res, 200, "ok\n");
    return;
  }

  // Does the shared UI load through Vite's SSR pipeline? Increment 2's entire
  // premise, answered in one request before a line of rendering exists — and a
  // fast, unambiguous failure if `ssr.noExternal` is wrong.
  if (method === "GET" && url.pathname === "/probe") {
    const mod = (await vite.ssrLoadModule("/src/probe.ts")) as {
      probe: () => { screen: string };
    };
    sendText(res, 200, `@leapsake/ui loaded via SSR: ${mod.probe().screen}\n`);
    return;
  }

  sendText(res, 404, "not found\n");
}

createServer((req, res) => {
  // Vite's middleware first: it owns `/@vite/*`, `/@fs/*`, and every transformed
  // module URL. `next()` falls through to our routes, so the switch above only
  // ever sees requests Vite did not claim.
  vite.middlewares(req, res, () => {
    handle(req, res).catch((error: unknown) => {
      // `ssrFixStacktrace` maps the transformed stack back to source lines;
      // without it every SSR error points at generated code.
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      console.error(error);
      sendText(res, 500, `${error}\n`);
    });
  });
}).listen(port, () => {
  console.log(`web-spike listening on http://localhost:${port}`);
});
