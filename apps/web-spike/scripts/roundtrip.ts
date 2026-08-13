import { DatabaseSync } from "node:sqlite";
import { createInMemoryKeyStore } from "@leapsake/crypto";
import {
  createCore,
  joinAccount,
  runAccountSync,
  runMigrations,
} from "@leapsake/core";
import { createHttpSyncTransport } from "@leapsake/sync";
import { tagLabel } from "@leapsake/schema";
import { nodeSqliteDriver } from "../src/node-sqlite-driver.js";

/**
 * **Increment 3's done-when, as a runnable script.** Create, edit and delete a
 * person on the no-JS web client, and watch all three arrive on a *second
 * device* through a real relay.
 *
 * ```sh
 * pnpm --filter @leapsake/web-spike roundtrip \
 *   --relay http://localhost:4001 --host http://localhost:5180 \
 *   --username ada --password 'hunter2 hunter2'
 * ```
 *
 * ## Why the check has to be a second device, and not the web client again
 *
 * A cold store already proves *something*: the request after a write throws its
 * database away and rebuilds it from the relay, so anything still on the page
 * demonstrably came back down the wire. But it cannot tell a **tombstone** from
 * "never existed", or a rename from "always said that" — a stateless observer
 * has nothing to merge against. Only a peer holding the *old* row can show that
 * the delete propagated rather than merely failed to appear, which is exactly
 * the confusion the spike doc singles out.
 *
 * So the peer here is a real joining device: `joinAccount` (account row, device
 * registration, master key adopted under an enclave) over a **file-backed**
 * store, and `runAccountSync` — which is `createAccountSyncEngine` with durable
 * `sync_state` watermarks, the same call desktop's IPC handler makes. It holds
 * the previous state of every row before each web write, so LWW is doing real
 * work at every step.
 *
 * ## What it is not
 *
 * Not Electron. The renderer and the at-rest encrypted driver are absent — this
 * runs `node:sqlite` against a plain file, like everything else in the spike.
 * Neither touches sync semantics (the envelope is layer 2, applied by the
 * engine; the at-rest cipher is layer 1, under the driver), so the round trip
 * this proves is the one desktop makes. Recorded rather than glossed, in the
 * same spirit as Increment 2's "verified by parsing the markup, not by driving
 * Firefox".
 *
 * The web half is driven with `fetch` and a hand-held cookie, posting
 * `application/x-www-form-urlencoded` — which is precisely what a browser with
 * JavaScript disabled sends, and the reason no browser is needed to prove it.
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

const relayUrl = arg("relay", "http://localhost:4001");
const hostUrl = arg("host", "http://localhost:5180").replace(/\/$/, "");
const username = arg("username");
const password = arg("password");
const storePath = arg("store", `/tmp/leapsake-web-spike-peer-${Date.now()}.db`);

// ---------------------------------------------------------------------------
// The web client, driven exactly as a no-JS browser drives it.
// ---------------------------------------------------------------------------

let cookie = "";

/**
 * One request to the SSR host. `redirect: "manual"` on purpose — the 303 target
 * is an assertion, not a step to follow: a create that lands on `/duplicates`
 * rather than the new person is a different outcome, and following the redirect
 * would hide which one happened.
 */
async function web(
  method: "GET" | "POST",
  path: string,
  form?: Record<string, string>,
): Promise<{ status: number; location: string | null; body: string }> {
  const response = await fetch(`${hostUrl}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie === "" ? {} : { cookie }),
      ...(form === undefined
        ? {}
        : { "content-type": "application/x-www-form-urlencoded" }),
    },
    body: form === undefined ? undefined : new URLSearchParams(form).toString(),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie !== null) cookie = setCookie.split(";")[0] as string;
  return {
    status: response.status,
    location: response.headers.get("location"),
    body: await response.text(),
  };
}

// ---------------------------------------------------------------------------
// The peer device.
// ---------------------------------------------------------------------------

const keyStore = createInMemoryKeyStore();
const driver = nodeSqliteDriver(new DatabaseSync(storePath));
await runMigrations(driver);

const session = await joinAccount({
  keyStore,
  driver,
  // The credential-less bootstrap channel a joining device has to use — it has
  // no verifier until it derives one from the password.
  transport: createHttpSyncTransport({ baseUrl: relayUrl }),
  relayUrl,
  username,
  password,
  platform: "spike-peer",
});
const peer = createCore(driver);

/**
 * Pull the peer up to date and report what one person looks like from over there.
 *
 * The name is spelled out field by field rather than through `fullName`, which
 * is first + last by design — a middle name that never crossed the wire would
 * pass unnoticed. Tags come from `views.person`, so the check covers both halves
 * of what `people.create/update` writes in one transaction.
 */
async function peerSees(personId: string): Promise<{
  applied: number;
  name: string | null;
  gender: string | null;
  tags: string;
  listed: boolean;
}> {
  const { applied } = await runAccountSync({
    keyStore,
    driver,
    masterKey: session.masterKey,
  });
  const view = await peer.views.person(personId);
  const listed = (await peer.people.list()).some((p) => p.id === personId);
  if (view === null) {
    return { applied, name: null, gender: null, tags: "", listed };
  }
  const { person, tags } = view;
  return {
    applied,
    name: [person.firstName, person.middleName, person.lastName]
      .filter((part) => part !== null && part !== "")
      .join(" "),
    gender: person.gender,
    tags: tags
      .map((tag) => tagLabel(tag.name))
      .sort()
      .join(" "),
    listed,
  };
}

const pass: boolean[] = [];
function check(label: string, ok: boolean, detail: string): void {
  pass.push(ok);
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${detail}`);
}

console.log(`peer joined "${username}" at ${relayUrl}`);
console.log(`  device ${session.deviceId}`);
console.log(`  store  ${storePath}`);

const baseline = await runAccountSync({
  keyStore,
  driver,
  masterKey: session.masterKey,
});
const before = (await peer.people.list()).length;
console.log(`  baseline: ${baseline.applied} records applied, ${before} people`);

// --- C -------------------------------------------------------------------
console.log("\nC — create, with JavaScript disabled");
const login = await web("POST", "/login", { username, password });
if (login.status !== 303) throw new Error(`login failed: ${login.status}`);

// A fresh surname per run, because the create redirect is **detection-driven**:
// the ported action asks `duplicates.findFor` and sends a matched person to
// `/duplicates?for=` instead. Re-running with a fixed name means every run after
// the first exercises the other arm, which makes the check non-deterministic.
// The first run against this account discovered that by accident, and it is the
// more interesting half of the finding — see the README.
const surname = `Hopper-${Date.now().toString(36).slice(-4)}`;
const created = await web("POST", "/people/new", {
  firstName: "Grace",
  middleName: "Brewster",
  lastName: surname,
  gender: "female",
  tags: "#navy #compilers",
});
// Both arms of the ported redirect end in a person id; which one fired is worth
// reporting, so it is parsed rather than assumed.
const personId =
  /\/people\/([^/?#]+)$/.exec(created.location ?? "")?.[1] ??
  /[?&]for=([^&]+)/.exec(created.location ?? "")?.[1] ??
  "";
check(
  "web 303s to the new person",
  created.status === 303 &&
    created.location === `/people/${personId}` &&
    personId !== "",
  `${created.status} → ${created.location}`,
);

const afterCreate = await peerSees(personId);
check(
  "peer sees the create — every field, tags included",
  afterCreate.name === `Grace Brewster ${surname}` &&
    afterCreate.gender === "female" &&
    afterCreate.tags === "#compilers #navy",
  `${afterCreate.applied} applied, ${JSON.stringify(afterCreate.name)}, ` +
    `${afterCreate.gender}, tags [${afterCreate.tags}]`,
);

// --- U -------------------------------------------------------------------
console.log("\nU — edit, with JavaScript disabled");
const edited = await web("POST", `/people/${personId}/edit`, {
  firstName: "Grace",
  middleName: "Brewster",
  lastName: `${surname}-Murray`,
  gender: "female",
  tags: "#navy #compilers #admiral",
});
check(
  "web 303s back to the person",
  edited.status === 303 && edited.location === `/people/${personId}`,
  `${edited.status} → ${edited.location}`,
);

const page = await web("GET", `/people/${personId}`);
check(
  "the web page shows the new name",
  page.body.includes(`${surname}-Murray`),
  `GET ${page.status}, ${page.body.length} bytes`,
);

// The LWW half: the peer already holds "Hopper" from the create sync above, so
// this is a merge over an existing row rather than a first sighting.
const afterEdit = await peerSees(personId);
check(
  "peer merges the rename over its own row",
  afterEdit.name === `Grace Brewster ${surname}-Murray` &&
    afterEdit.tags === "#admiral #compilers #navy",
  `${afterEdit.applied} applied, ${JSON.stringify(afterEdit.name)}, ` +
    `tags [${afterEdit.tags}]`,
);

// --- D -------------------------------------------------------------------
console.log("\nD — delete, with JavaScript disabled");
const deleted = await web("POST", `/people/${personId}/delete`);
check(
  "web 303s to the list",
  deleted.status === 303 && deleted.location === "/people",
  `${deleted.status} → ${deleted.location}`,
);

const list = await web("GET", "/people");
check(
  "the person is off the web list",
  !list.body.includes(personId),
  `GET ${list.status}, ${list.body.length} bytes`,
);

// The strict one. A tombstone is where "it vanished locally" and "it
// propagated" are easiest to confuse, so both halves are asserted: the peer
// must stop listing the person **and** must have applied records to do it —
// a peer that simply never heard of them would also pass the first half.
const afterDelete = await peerSees(personId);
check(
  "peer applies the tombstone",
  !afterDelete.listed && afterDelete.applied > 0,
  `${afterDelete.applied} applied, still listed: ${afterDelete.listed}`,
);

const finalCount = (await peer.people.list()).length;
check(
  "peer is back to its baseline count",
  finalCount === before,
  `${finalCount} people (baseline ${before})`,
);

console.log(
  `\n${pass.every(Boolean) ? "PASS" : "FAIL"} — ${pass.filter(Boolean).length}/${pass.length} checks`,
);
process.exit(pass.every(Boolean) ? 0 : 1);
