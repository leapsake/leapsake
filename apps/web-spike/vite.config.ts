import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite in **middleware mode** (see `plans/v0-1_web-spike.md` → *Decisions already
 * made*): `src/server.ts` owns the `node:http` server and asks Vite only to
 * transform modules on demand. One origin then covers SSR pages, the client
 * bundle, the `.wasm`, and (later) the relay proxy.
 *
 * `apps/server`'s plain-`tsx` pattern is ruled out by two things, and both are
 * exactly what `ssr.noExternal` fixes:
 *
 * - `packages/ui/src/web/primitives/Combobox.tsx` imports a CSS module, and it is
 *   on `PersonScreen`'s render path (`HolidaysSection` → `MultiAddCombobox`).
 *   Node cannot load `.module.css`; Vite can.
 * - `packages/*` write internal imports as `.js` specifiers pointing at `.ts`
 *   files, so they must be transformed rather than handed to Node's resolver.
 *
 * Same reasoning `apps/desktop/electron.vite.config.ts` records for its
 * `externalizeDepsPlugin({ exclude })` — and unlike that config we can use a
 * regex, so no package list needs maintaining here.
 */
export default defineConfig({
  server: { middlewareMode: true },
  appType: "custom",
  ssr: {
    noExternal: [/^@leapsake\//],
  },
  optimizeDeps: {
    // Increment 5a, and **load-bearing** — observed, not assumed. The package
    // resolves its binary with `new URL("sqlite3.wasm", import.meta.url)`, so
    // pre-bundling it to `node_modules/.vite/deps/` moves the module and leaves the
    // `.wasm` behind. What that looks like is *not* a build error: the page loads,
    // then emscripten aborts at init with "both async and sync fetching of the wasm
    // failed", naming neither Vite nor the missing file. Excluded, the module is
    // served from its own directory and the relative URL holds.
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  // Increment 5c's worker is an ES module — it awaits `installOpfsSAHPoolVfs()`
  // at the top level and imports `@leapsake/*` — and dev serves it as one
  // natively. This line only matters to `vite build`, whose default is an IIFE
  // that neither top-level `await` nor those imports survive; recorded here so a
  // production build does not rediscover it as a mystery.
  worker: { format: "es" },
  // React 19.2.3 exactly — the hoisted root pair, so the spike adds no nested
  // copy (AGENTS.md → *React version policy*). Desktop's 19.2.7 is its own
  // bundle's business.
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  plugins: [react()],
});
