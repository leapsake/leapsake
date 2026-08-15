import { defineConfig } from "vitest/config";

/**
 * The driver-contract **coverage forcer** (the "authoring forcer" from
 * plans/testing/README.md → "Keeping the contract from going stale").
 *
 * It runs the shared `runDriverContract` spec (plus the desktop wrong-key open
 * test) against the production desktop driver and gates on **100% coverage of the
 * driver file**. The point isn't a coverage vanity metric: it means a *new* driver
 * code path mechanically fails this gate until a contract case exercises it — so the
 * one spec both drivers run can't silently fail to grow when the driver does. The
 * port implementation (`encryptedSqliteDriver`) is reachable here only through the
 * contract, so that half of the file is the contract's forcer specifically.
 *
 * Desktop-only: the mobile `expoSqliteDriver` can't load under Node (native module,
 * see apps/mobile/README.md); its equivalent coverage lives in the in-app
 * self-test, which runs this same contract. Kept in its own config so day-to-day
 * `pnpm test:node` stays coverage-free and fast.
 */
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
