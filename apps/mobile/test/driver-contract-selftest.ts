import * as SQLite from "expo-sqlite";
import { generateKey, rawKeyLiteral } from "@leapsake/crypto";
import { runDriverContract } from "@leapsake/data/testing";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";
import { type CaseResult, createCollectingTestApi } from "./test-api";

/**
 * The mobile native test tier (testing keystone): run the shared
 * {@link runDriverContract} spec against the *production* `expoSqliteDriver` over a
 * real, encrypted expo-sqlite database, in the app's own runtime on a
 * simulator/emulator. expo-sqlite is a native module that can't load headlessly, so
 * this is the only prod-faithful way to pin the mobile driver to the same observable
 * contract desktop's Vitest run pins its driver to (`plans/testing/mobile-engine.md`).
 */

/**
 * A fresh, isolated, *encrypted* throwaway DB per call — the contract provisions
 * and tears down a driver per case. Mirrors the production open path
 * (`apps/mobile/lib/core-context.tsx`): `PRAGMA key` as the very first statement on
 * the connection, before any access. Opened synchronously (and keyed via `execSync`)
 * so this satisfies the contract's synchronous `DriverFactory` while the driver's
 * query methods stay async — exactly the methods production calls. `crypto.randomUUID`
 * is polyfilled at boot in `apps/mobile/index.ts`.
 */
function makeExpoTestDriver() {
  const name = `selftest-${crypto.randomUUID()}.db`;
  const db = SQLite.openDatabaseSync(name);
  db.execSync(`PRAGMA key = "${rawKeyLiteral(generateKey())}"`);
  return {
    driver: expoSqliteDriver(db),
    cleanup: async () => {
      // Tolerate a handle a test already closed through the driver's `close()`
      // (the contract's close case does exactly this) — expo-sqlite throws
      // "Access to closed resource" on a double `closeSync`. This mirrors the
      // desktop factory's `if (db.open)` guard; expo-sqlite exposes no `isOpen`,
      // so we swallow the already-closed throw rather than test a flag.
      try {
        db.closeSync();
      } catch {
        // already closed by the test — nothing to do
      }
      await SQLite.deleteDatabaseAsync(name);
    },
  };
}

/** Register the contract against the real driver and execute it, returning a
 *  pass/fail result per case for the self-test screen to render. */
export async function runDriverContractSelfTest(): Promise<CaseResult[]> {
  const { api, run } = createCollectingTestApi();
  runDriverContract(api, makeExpoTestDriver);
  return run();
}
