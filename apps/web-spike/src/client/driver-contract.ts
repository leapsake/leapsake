import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { migrations, runMigrations } from "@leapsake/data";
import { runDriverContract } from "@leapsake/data/testing";
import { wasmSqliteDriver } from "../wasm-sqlite-driver.js";
import { type CaseResult, createCollectingTestApi } from "./test-api.js";

/**
 * **Increment 5a**: the shared driver contract, run **in a browser**, against
 * `@sqlite.org/sqlite-wasm`.
 *
 * This is mobile's native test tier with one word changed. `apps/mobile` cannot
 * load expo-sqlite headlessly, so it runs the *same* `runDriverContract` spec on a
 * simulator and reports PASS/FAIL on screen; a browser engine cannot load in
 * Vitest's Node environment either, so it runs here and reports PASS/FAIL on a
 * page. The contract is framework-agnostic by design for exactly this — it
 * imports no runner — and `test-api.ts` beside this file is a **byte-identical
 * copy** of `apps/mobile/test/test-api.ts` (`diff` says so), which is itself a
 * finding: the runner-shaped shim is now wanted by a second non-Vitest host, and
 * it lives in an app. See `WANTED-CHANGES.md`.
 *
 * ## The one piece of real engineering here
 *
 * `DriverFactory` is **synchronous** — the contract provisions a fresh driver per
 * case — and `sqlite3InitModule()` is **asynchronous**. So the module is awaited
 * once, at the top level of this file, and the factory then does nothing but
 * `new sqlite3.oo1.DB(...)`, which is synchronous. The mobile factory pulls the
 * same trick with `SQLite.openDatabaseSync`, and it is why the port's *async*
 * query methods do not force an async *factory*.
 *
 * Deliberately `:memory:` and deliberately on the main thread. OPFS and the
 * Worker are Increment 5c, and mixing them in would mean a red result could not
 * say *which* of three new things broke.
 */

const started = performance.now();

/**
 * Awaited once, before any test registers. `print`/`printErr` land in the console
 * so an engine-level failure (a `.wasm` that did not load, an OOM) is legible
 * rather than a silent absence of results.
 */
const sqlite3 = await sqlite3InitModule({
  print: console.log,
  printErr: console.error,
});

const bootMs = Math.round((performance.now() - started) * 10) / 10;

/** A fresh, isolated, throwaway database per contract case. */
function makeWasmTestDriver() {
  const db = new sqlite3.oo1.DB(":memory:");
  return {
    driver: wasmSqliteDriver(db),
    // `close()` is documented as a no-op on an already-closed handle, so the
    // contract's own close case needs no guard here — unlike desktop's `if
    // (db.open)` and mobile's swallowed throw.
    cleanup: () => {
      db.close();
    },
  };
}

/**
 * The app's real schema, applied to a browser database. The contract proves the
 * *port*; this proves the **migrations are as portable as they claim to be** —
 * `packages/data/src/migrations.ts` is plain DDL whose only exotic statement is
 * `PRAGMA user_version`, and that claim has until now only ever been checked
 * against `node:sqlite` and expo-sqlite.
 */
async function migrationsCase(): Promise<{
  result: CaseResult;
  detail: string;
}> {
  const expected = Math.max(...migrations.map((step) => step.version));
  const db = new sqlite3.oo1.DB(":memory:");
  const driver = wasmSqliteDriver(db);
  const from = performance.now();
  try {
    await runMigrations(driver);
    const ms = Math.round((performance.now() - from) * 10) / 10;

    const version = await driver.get<{ user_version: number }>(
      "PRAGMA user_version",
    );
    const tables = await driver.all<{ name: string }>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const indexes = await driver.all(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
    );

    const detail =
      `${migrations.length} migrations → user_version ${version?.user_version}, ` +
      `${tables.length} tables, ${indexes.length} indexes, ${ms} ms`;

    return version?.user_version === expected
      ? { result: { name: "runMigrations completes", status: "pass" }, detail }
      : {
          result: {
            name: "runMigrations completes",
            status: "fail",
            error: `user_version is ${version?.user_version}, expected ${expected}`,
          },
          detail,
        };
  } catch (error) {
    return {
      result: {
        name: "runMigrations completes",
        status: "fail",
        error: error instanceof Error ? error.message : String(error),
      },
      detail: "threw",
    };
  } finally {
    db.close();
  }
}

// --- Run, then write the answer where a person and a screenshot can read it ---

const { api, run } = createCollectingTestApi();
runDriverContract(api, makeWasmTestDriver);
const contract = await run();
const migrated = await migrationsCase();

const passed = contract.filter((c) => c.status === "pass").length;
const score = `${passed}/${contract.length}`;
const ok = passed === contract.length && migrated.result.status === "pass";
const totalMs = Math.round((performance.now() - started) * 10) / 10;

function line(result: CaseResult): HTMLLIElement {
  const item = document.createElement("li");
  item.textContent = `${result.status === "pass" ? "✓" : "✗"} ${result.name}${
    result.error === undefined ? "" : ` — ${result.error}`
  }`;
  item.style.color = result.status === "pass" ? "inherit" : "#b00";
  return item;
}

const host = document.getElementById("contract");
if (host !== null) {
  host.textContent = "";

  const banner = document.createElement("h2");
  banner.id = "verdict";
  // The done-when in one string, so a tab screenshot is the evidence.
  banner.textContent = `${ok ? "PASS" : "FAIL"} — ${score} contract, ${
    migrated.result.status === "pass" ? "migrations OK" : "migrations FAILED"
  }`;
  host.appendChild(banner);

  const engine = document.createElement("p");
  engine.textContent =
    `sqlite ${sqlite3.version.libVersion} via @sqlite.org/sqlite-wasm, ` +
    `:memory: on the main thread — module init ${bootMs} ms, run ${totalMs} ms`;
  host.appendChild(engine);

  const list = document.createElement("ul");
  for (const result of contract) list.appendChild(line(result));
  host.appendChild(list);

  const schema = document.createElement("p");
  schema.appendChild(line(migrated.result));
  const detail = document.createElement("small");
  detail.textContent = ` ${migrated.detail}`;
  schema.appendChild(detail);
  host.appendChild(schema);
}

// The title carries the verdict too: it is what a browser tab shows, and it is
// the one part of the page a manual check cannot misread.
document.title = `${ok ? "PASS" : "FAIL"} ${score} — driver contract`;
console.log(`${ok ? "PASS" : "FAIL"} — ${score}, ${migrated.detail}`);
