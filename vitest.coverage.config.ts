import { defineConfig } from "vitest/config";

// The driver contract's coverage forcer; see `CONTRIBUTING.md` → _Testing_.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/desktop/test/integration/driver-contract.test.ts",
      "apps/desktop/test/integration/encrypted-open.test.ts",
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["apps/desktop/src/main/db/encrypted-sqlite-driver.ts"],
      reporter: ["text"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
