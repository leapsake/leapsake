import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `node` is the default; the component tests in `packages/ui` opt into jsdom
    // per-file with a `@vitest-environment jsdom` docblock, so every other tier
    // (repos, drivers, pure logic) keeps running without a DOM.
    environment: "node",
    include: [
      "packages/*/{src,test}/**/*.test.{ts,tsx}",
      // The release path's pure logic (version/tag algebra). It lives in `scripts/`
      // rather than a package because it has exactly one consumer, but its mistakes are
      // permanent — a store version cannot go backwards — so it carries tests.
      "scripts/**/*.test.mjs",
      "apps/server/{src,test}/**/*.test.ts",
      "apps/desktop/test/**/*.test.ts",
      "apps/mobile/lib/**/*.test.ts",
      // Builds the site and asserts the artifact — see the file's own header for
      // why it is a single file.
      "apps/website/test/**/*.test.ts",
    ],
  },
});
