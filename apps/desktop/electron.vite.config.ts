import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// `@leapsake/*` are workspace packages published as raw TypeScript source (no
// build step), so they must be bundled/transpiled rather than externalized.
const bundleWorkspacePackages = externalizeDepsPlugin({
  exclude: ["@leapsake/schema", "@leapsake/data"],
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
