import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Component tests opt into jsdom per file with a docblock.
    environment: "node",
    // Real Argon2id and SQLite work, on a runner that shares its cores with an
    // emulator.
    testTimeout: 15_000,
    // Lowers the Argon2id cost; see `packages/crypto` → _The test cost_.
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "packages/*/{src,test}/**/*.test.{ts,tsx}",
      "scripts/**/*.test.mjs",
      "apps/server/{src,test}/**/*.test.ts",
      "apps/desktop/test/**/*.test.ts",
      "apps/mobile/lib/**/*.test.ts",
      "apps/mobile/db/**/*.test.ts",
      // One file, so its `astro build`s run in order; see that file's header.
      "apps/website/test/**/*.test.ts",
    ],
  },
});
