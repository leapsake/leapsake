import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Bundles every `@leapsake/*` dependency, which ships raw TypeScript; see
// `packages/README.md` → _Consumed as raw TypeScript_.
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
