import { DatabaseSync } from "node:sqlite";
import { createInMemoryKeyStore, encodeRecoveryPhrase } from "@leapsake/crypto";
import {
  enableSync,
  ensureDeviceMasterKey,
  registerAccountWithRelay,
  runAccountSync,
  runMigrations,
} from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import { nodeSqliteDriver } from "../test/node-sqlite-driver.js";

/**
 * **Seed a relay with an account that belongs to somebody else** — a dev tool for
 * hand-verifying the flows that need an account to *already exist*, without
 * standing up a second client to create it.
 *
 * The two it exists for (`encryption/model.md` §7.2.2):
 *
 * - **The 409 fork.** Binding a local-only account to a relay only forks to
 *   merge-or-rename when the handle is taken, so the handle has to be taken by
 *   someone first.
 * - **The merge.** Merging needs a real account with real published doors, and a
 *   real password to log in with — everything this seeds.
 *
 * The people it creates are the point, not filler: `--duplicate` seeds a person
 * the tester also has locally, so the post-merge duplicate review has something
 * to surface. The account's store is in-memory and thrown away; only what the
 * relay holds outlives this process.
 *
 * ```sh
 * pnpm --filter @leapsake/server exec tsx scripts/seed-account.ts \
 *   --relay http://localhost:4000 --username mary --password 'hunter2 hunter2'
 * ```
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
// Someone the tester is likely to also have locally, so the merge has an overlap
// to review. `--duplicate ""` seeds nobody.
const duplicate = arg("duplicate", "Jane Wainwright");

const keyStore = createInMemoryKeyStore();
const driver = nodeSqliteDriver(new DatabaseSync(":memory:"));
await runMigrations(driver);
const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
const { account, recoveryKey, bootstrap } = await enableSync({
  keyStore,
  driver,
  username,
  password,
  relayUrl,
  platform: "desktop",
});

await registerAccountWithRelay({ relayUrl, bootstrap });

const people = createPeopleRepo(driver);
const seeded: string[] = [];
if (duplicate.trim() !== "") {
  const [firstName, ...rest] = duplicate.trim().split(/\s+/);
  await people.create({ firstName, lastName: rest.join(" ") || "—" });
  seeded.push(duplicate.trim());
}
// A second person who is unique to this account, so a merge can be seen to bring
// data *in* as well as to surface overlaps.
await people.create({ firstName: "Harry", lastName: "Gower" });
seeded.push("Harry Gower");

await runAccountSync({ keyStore, driver, masterKey });

console.log(`Seeded "${account.username}" on ${relayUrl}`);
console.log(`  account id      ${account.id}`);
console.log(`  password        ${password}`);
console.log(`  recovery phrase ${encodeRecoveryPhrase(recoveryKey)}`);
console.log(`  people pushed   ${seeded.join(", ")}`);
