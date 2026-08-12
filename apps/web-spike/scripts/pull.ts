import { DatabaseSync } from "node:sqlite";
import { createCore, runMigrations, syncableRepos } from "@leapsake/core";
import { createHttpSyncTransport, createSyncEngine } from "@leapsake/sync";
import { nodeSqliteDriver } from "../src/node-sqlite-driver.js";
import { bootstrapMasterKey } from "../src/bootstrap.js";
import { instrumentTransport, reportRow, timed } from "../src/measure.js";

/**
 * **Increment 1's done-when, as a runnable script.** A second process, given only
 * a username and a password, reconstructs the account's store from the relay:
 *
 * ```sh
 * pnpm --filter @leapsake/web-spike pull --username ada --password 'hunter2 hunter2'
 * ```
 *
 * This is the SSR request path with the rendering removed — the same four-call
 * bootstrap, the same cold in-memory store, the same `pull(0)`. Increment 2's
 * `src/session.ts` is this file with a cookie around it, which is why the
 * measurement lives here: the numbers it prints are the **cold** half of the
 * cold-vs-warm decision the spike doc calls a measurement rather than a
 * preference.
 *
 * It deliberately holds no `KeyStore` and writes no `account` row. If something
 * later turns out to require one, that is a finding about the shape of the
 * client, not a line to quietly add here.
 */

function arg(name: string, fallback?: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} is required`);
  }
  return value;
}

const relayUrl = arg("relay", "http://localhost:4000");
const username = arg("username");
const password = arg("password");

// 1-4: username + password → the account's master key, holding nothing.
const { accountId, masterKey, authVerifier, argon2Ms, argon2LagMs } =
  await bootstrapMasterKey({ relayUrl, username, password });

// A cold store: fresh in-memory database, migrated, no account row, no key store.
const driver = nodeSqliteDriver(new DatabaseSync(":memory:"));
const { ms: migrateMs } = await timed(() => runMigrations(driver));

const transport = instrumentTransport(
  createHttpSyncTransport({
    baseUrl: relayUrl,
    accountId,
    // The verifier the KDF just produced *is* the bearer credential — no session
    // was persisted anywhere between the two processes.
    authVerifier,
  }),
);

const engine = createSyncEngine({
  transport,
  masterKey,
  repos: syncableRepos(driver),
});
const { value: pulled, ms: pullMs } = await timed(() => engine.pull(0));

const core = createCore(driver);
const people = await core.people.list();
const holidays = await core.holidays.list();

console.log(`Pulled "${username}" from ${relayUrl} into a cold store`);
console.log(`  account id       ${accountId}`);
console.log(
  `  argon2id         ${argon2Ms} ms   (worst event-loop stall: ${argon2LagMs} ms)`,
);
console.log(`  migrations       ${migrateMs} ms`);
console.log(
  `  applied          ${pulled.applied} records → cursor ${pulled.cursor}`,
);
console.log(`  people           ${people.length}`);
console.log(`  holidays         ${holidays.length}`);
console.log(
  reportRow("  pull", {
    rows: pulled.applied,
    totalMs: pullMs,
    stats: transport.stats(),
  }),
);
console.log("");
console.log(
  `  cold-path total  ${Math.round((argon2Ms + migrateMs + pullMs) * 10) / 10} ms`,
);
console.log(
  `  (the spike doc's decision rule: under ~150 ms ⇒ take cold-per-request)`,
);
