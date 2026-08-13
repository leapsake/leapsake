import { DatabaseSync } from "node:sqlite";
import { createInMemoryKeyStore, encodeRecoveryPhrase } from "@leapsake/crypto";
import {
  createCore,
  enableSync,
  ensureDeviceMasterKey,
  registerAccountWithRelay,
  runMigrations,
  seedHolidayCatalog,
  syncableRepos,
} from "@leapsake/core";
import { createPeopleRepo, createSyncStateRepo } from "@leapsake/data";
import { createHttpSyncTransport, createSyncEngine } from "@leapsake/sync";
import { mentionToken } from "@leapsake/schema";
import { nodeSqliteDriver } from "../src/node-sqlite-driver.js";
import { instrumentTransport, reportRow, timed } from "../src/measure.js";

/**
 * **Seed a relay account for the web spike**, then push everything to it.
 *
 * The spike's whole premise is a *stateless* renderer: it holds no store of its
 * own and reconstructs one per session from the relay. So the fixture cannot be
 * a local database file — it has to be an account on a real relay, which is what
 * this creates. The local store here is `:memory:` and thrown away; only what the
 * relay holds outlives the process.
 *
 * The chain mirrors `enableAndRegister` in `apps/server/test/relay.test.ts` with
 * a write phase bolted on:
 *
 * ```
 * runMigrations → createInMemoryKeyStore → ensureDeviceMasterKey
 *   → enableSync → registerAccountWithRelay → seedHolidayCatalog
 *   → writes → createSyncEngine(...).push(0)
 * ```
 *
 * ## Run it
 *
 * ```sh
 * # Terminal 1 — a throwaway relay with the throttles lifted (see below).
 * RELAY_DB=:memory: RELAY_BOOTSTRAP_RATE_LIMIT_MAX=100000 \
 *   RELAY_RATE_LIMIT_MAX=100000 pnpm server
 *
 * # Terminal 2
 * pnpm --filter @leapsake/web-spike seed --username ada --password 'hunter2 hunter2'
 * ```
 *
 * ## The rate-limit env vars are the first finding, not a dev convenience
 *
 * `/accounts/session` and `/accounts/bootstrap` share a 10-per-60s **per-IP**
 * failed-login budget. An SSR host logs in from **one IP on behalf of every
 * user**, so a per-IP budget is structurally wrong for a web client: ten users
 * fat-fingering a password locks out the eleventh. Seeding at `--rows 10000`
 * trips it long before a real deployment would. Record it; do not patch it here.
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
// 100 / 1k / 10k are the three measurement points the findings table wants.
const rows = Number(arg("rows", "100"));

// `enableSync` runs Argon2id over this; the custody flows require ≥ 12 chars, so
// fail here rather than inside the KDF with a less obvious message.
if (password.length < 12) {
  throw new Error("--password must be at least 12 characters");
}

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
  // The account is being established *by* a web client, which is a platform the
  // device table has not carried before. If the relay or the device repo objects,
  // that is itself a finding.
  platform: "web",
});
await registerAccountWithRelay({ relayUrl, bootstrap });

// **Seed the holiday catalog**, so no pull measurement flatters a real login by
// however much of it the catalog would have been.
//
// The plan doc calls it "the bulk of a fresh account's log". Measured, it is 16
// rows — 12% of a 128-row account, 0.2% of a 10k one. Still seeded (it is free
// and it is what a real account holds), but the findings should not repeat the
// claim as written.
const { value: seeded, ms: catalogMs } = await timed(() =>
  seedHolidayCatalog({ driver }),
);

// --- The write phase -------------------------------------------------------
//
// One **rich** person carrying every section `PersonScreen` renders, because
// Increment 2's done-when is that page showing real content — a page of empty
// sections proves nothing. Then plain filler people to reach `--rows`.
const core = createCore(driver);

const ada = await core.people.create(
  { firstName: "Ada", lastName: "Lovelace", gender: "female" },
  ["family", "london"],
);
await core.contactMethods.emails.create({
  ownerType: "person",
  ownerId: ada.id,
  label: "home",
  address: "ada@example.com",
});
await core.contactMethods.phones.create({
  ownerType: "person",
  ownerId: ada.id,
  label: "mobile",
  number: "+44 20 7946 0018",
});
await core.milestones.create({
  kind: "birthday",
  bearerType: "person",
  bearerId: ada.id,
  year: 1815,
  month: 12,
  day: 10,
});
const charles = await core.people.create(
  { firstName: "Charles", lastName: "Babbage" },
  [],
);
const friendship = await core.relationships.create({
  aType: "person",
  aId: ada.id,
  aRole: "friend",
  bType: "person",
  bId: charles.id,
  bRole: "friend",
});
// A milestone **on the relationship**, so Increment 4 has something to share
// that is not just two names. `RelationshipScreen` is the canonical home for
// relationship-kind milestones, and a share of an empty screen would prove the
// wiring without proving the payload.
await core.milestones.create({
  kind: "met",
  bearerType: "relationship",
  bearerId: friendship.id,
  year: 1833,
  month: 6,
  day: 5,
});
// An inline `@mention` so `MentionedInSection` has a backlink to render — the one
// section on the page fed by a reverse index rather than a direct read.
await core.reminders.create({
  title: "Send the analytical engine notes",
  body: `Promised to ${mentionToken("Ada Lovelace", "person", ada.id)} #followup`,
  dueDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
});

// The filler goes through the **repo**, not `core.people.create`, on purpose:
// every core write runs a full `regenerateSystem()` reconcile afterwards, which
// is right for a UI and quadratic for a bulk seed (10k people ⇒ 10k reconciles
// over a growing table). The rows are identical either way — the reconcile is
// about reminders, and these filler people have no milestones to reconcile.
const people = createPeopleRepo(driver);
const { ms: fillerMs } = await timed(async () => {
  for (let i = 0; i < Math.max(0, rows - 2); i++) {
    await people.create({ firstName: `Person${i}`, lastName: "Filler" });
  }
});

// --- Push ------------------------------------------------------------------
const transport = instrumentTransport(
  createHttpSyncTransport({
    baseUrl: relayUrl,
    accountId: account.id,
    authVerifier: account.authVerifier,
  }),
);
const engine = createSyncEngine({
  transport,
  masterKey,
  repos: syncableRepos(driver),
  syncState: createSyncStateRepo(driver),
});
const { value: hwm, ms: pushMs } = await timed(() => engine.push(0));

console.log(`Seeded "${account.username}" on ${relayUrl}`);
console.log(`  account id       ${account.id}`);
console.log(`  password         ${password}`);
console.log(`  recovery phrase  ${encodeRecoveryPhrase(recoveryKey)}`);
console.log(`  person id        ${ada.id}   (the rich one)`);
console.log(
  `  holiday catalog  ${seeded.seeded ? "seeded" : "already current"} in ${catalogMs} ms`,
);
console.log(`  filler people    ${Math.max(0, rows - 2)} in ${fillerMs} ms`);
console.log(`  push high-water  ${hwm}`);
console.log(
  reportRow("  push", { rows, totalMs: pushMs, stats: transport.stats() }),
);
console.log("");
console.log(`Now, from a second process:`);
console.log(
  `  pnpm --filter @leapsake/web-spike pull --username ${username} --password '${password}'`,
);
