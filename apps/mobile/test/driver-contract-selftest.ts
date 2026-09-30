import * as SQLite from "expo-sqlite";
import { generateKey, rawKeyLiteral } from "@leapsake/crypto";
import { runDriverContract } from "@leapsake/data/testing";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";
import { runCustodySelfTest } from "./custody-selftest";
import { runSharedObjectRaceSelfTest } from "./shared-object-race-selftest";
import { type CaseResult, createCollectingTestApi } from "./test-api";

/** A throwaway encrypted database keyed first, as production opens one; sync
 *  only to satisfy the contract's synchronous `DriverFactory`. */
function makeExpoTestDriver() {
  const name = `selftest-${crypto.randomUUID()}.db`;
  const db = SQLite.openDatabaseSync(name);
  db.execSync(`PRAGMA key = "${rawKeyLiteral(generateKey())}"`);
  return {
    driver: expoSqliteDriver(db),
    cleanup: async () => {
      // A test may already have closed it; expo-sqlite has no `isOpen` and
      // throws on a double `closeSync`.
      try {
        db.closeSync();
      } catch {
        // already closed by the test — nothing to do
      }
      await SQLite.deleteDatabaseAsync(name);
    },
  };
}

/** Runs every on-device suite against the real engine under one PASS/FAIL,
 *  a result per case; see `apps/mobile/README.md`. */
export async function runDriverContractSelfTest(): Promise<CaseResult[]> {
  const { api, run } = createCollectingTestApi();
  runDriverContract(api, makeExpoTestDriver);
  runCustodySelfTest(api);
  runSharedObjectRaceSelfTest(api);
  return run();
}
