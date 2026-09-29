import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// `@leapsake/*` are workspace packages consumed as raw TypeScript source (no
// build step), so they must be bundled/transpiled here rather than externalized
// — externalizing one makes Electron's Node load its `.ts` source directly and
// fail on the `.js` import specifiers that resolve to `.ts` files. We derive the
// exclude list from our own `dependencies` so every current and future
// `@leapsake/*` package is covered automatically with no edit here.
// (`externalizeDepsPlugin` only accepts a string array, not a predicate.)
//
// NOTE: if any of these packages is ever to be published/consumed outside a
// bundler (plain Node, a separate repo), it will need its own build step (tsc
// emitting `dist/*.js` + types, with `exports` pointing at the built output) so
// its `.js` specifiers resolve natively. Until then, app-side bundling is the
// lighter-weight choice.
const { dependencies = {} } = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };
const bundleWorkspacePackages = externalizeDepsPlugin({
  exclude: Object.keys(dependencies).filter((dep) =>
    dep.startsWith("@leapsake/"),
  ),
});

export default defineConfig({
  main: {
    plugins: [bundleWorkspacePackages],
  },
  preload: {
    plugins: [bundleWorkspacePackages],
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
    plugins: [react()],
  },
});
