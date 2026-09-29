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

// Seeds a relay with somebody else's account, for hand-testing the 409 fork
// and the merge; the README's _Running_ shows how.

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
// Likely also on the tester's device, for the merge's duplicate review.
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
// Unique to this account, so a merge visibly brings data in.
await people.create({ firstName: "Harry", lastName: "Gower" });
seeded.push("Harry Gower");

await runAccountSync({ keyStore, driver, masterKey });

console.log(`Seeded "${account.username}" on ${relayUrl}`);
console.log(`  account id      ${account.id}`);
console.log(`  password        ${password}`);
console.log(`  recovery phrase ${encodeRecoveryPhrase(recoveryKey)}`);
console.log(`  people pushed   ${seeded.join(", ")}`);
