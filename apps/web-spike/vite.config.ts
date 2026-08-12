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
  // React 19.2.3 exactly — the hoisted root pair, so the spike adds no nested
  // copy (AGENTS.md → *React version policy*). Desktop's 19.2.7 is its own
  // bundle's business.
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  plugins: [react()],
});
