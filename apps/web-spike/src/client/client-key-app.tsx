import { createWorkerClient } from "./core-proxy.js";
import { clientGiftsPorts } from "./gifts-ports-client.js";
import { storageStatus } from "./key-custody.js";
import { mountPersonApp } from "./person-app.js";
import type { Stage } from "./worker-protocol.js";

/**
 * **Increment 5e**: the browser's answer to the `KeyStore` port, in one page.
 *
 * 5c left a browser client where the store, the schema and the sync cursor all
 * survive a reload and **the key alone does not** — so every warm start still
 * paid an Argon2id and two network calls to recover a master key it had held
 * moments earlier. This page closes that gap and, more to the point, *shows*
 * that it is closed:
 *
 * | | log in | resume |
 * | --- | --- | --- |
 * | password | typed | **none — the form is not even on screen** |
 * | Argon2id | ~450–1 100 ms | **not run** |
 * | network | `lookup` + `fetchBootstrap` + `pull` | **`fetch` throws; the count is in the verdict** |
 * | where the key comes from | the relay's `wrap(MK, kek)` | a non-extractable `CryptoKey` in IndexedDB |
 *
 * ## The two things a demo like this could fake, and how it does not
 *
 * 1. **"No relay" could just mean "nothing happened to need one."** So the
 *    worker deletes `fetch` for the duration of a resume rather than trusting
 *    the code path (`core-worker.ts` → `withNoNetwork`), and the resume fails
 *    loudly if anything reaches for it.
 * 2. **"It decrypted a row" could mean it opened something it had sealed
 *    itself**, which proves only that AES-GCM is symmetric. So the login stores
 *    an untouched `EncryptedRecord` **from the relay**, and the resume opens
 *    *that* — a ciphertext this browser did not produce, whose plaintext is a
 *    person the OPFS store also holds.
 */

// --- Page furniture, the same shape 5c's page uses ---------------------------

const stagesHost = document.getElementById("stages");
const table = document.createElement("table");
table.style.borderSpacing = "0.75rem 0.15rem";
stagesHost?.appendChild(table);

function stage(label: string, ms: number | null, detail = ""): void {
  const row = document.createElement("tr");
  const name = document.createElement("td");
  name.textContent = label;
  const cost = document.createElement("td");
  cost.style.textAlign = "right";
  cost.textContent = ms === null ? "" : `${ms} ms`;
  const note = document.createElement("td");
  note.textContent = detail;
  note.style.color = "#555";
  row.append(name, cost, note);
  table.appendChild(row);
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function say(id: string, text: string): void {
  const host = document.getElementById(id);
  if (host !== null) host.textContent = text;
}

function show(id: string, visible: boolean): void {
  const host = document.getElementById(id);
  if (host !== null) host.hidden = !visible;
}

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 90) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

// --- The worker, which is 5c's unchanged but for two new messages -------------

const worker = new Worker(new URL("./core-worker.ts", import.meta.url), {
  type: "module",
  name: "leapsake-core",
});

const client = createWorkerClient(worker, (message: Stage) => {
  stage(message.label, message.ms, message.detail);
});

/**
 * Asking for durable storage is **the page's job, not the worker's** —
 * `StorageManager.persist()` is `[Exposed=Window]`, so the thread that owns the
 * database and the wrap is the one thread that cannot protect them. Found by
 * calling it in the worker and reading "unavailable" back, and it is a real item
 * on 5d's list rather than a curiosity: an installed PWA whose key and store are
 * both evictable is a PWA that silently returns to a password login.
 */
void storageStatus().then((status) => {
  stage("storage bucket", null, `${status} — requested from the page, not the worker`);
});

client.ready.then(
  (ready) => {
    const held = ready.files.length === 0 ? "empty" : ready.files.join(", ");
    stage(
      "worker ready",
      round(ready.initMs + ready.vfsMs),
      `sqlite ${ready.libVersion} (${round(ready.initMs)} ms) + ` +
        `${ready.vfsName} (${round(ready.vfsMs)} ms) — OPFS holds: ${held}`,
    );

    // The page's own first question, answered before anyone clicks: is there a
    // key here? `peekCustody` reads the record without unwrapping it, which is
    // exactly what a real client's splash screen would have to do to decide
    // between showing a password field and showing the app.
    const custody = ready.custody;
    show("resume-form", custody !== null);
    show("login", custody === null);
    say(
      "custody",
      custody === null
        ? "No wrap in IndexedDB — this load needs the password. Log in once, then reload."
        : `A wrap is waiting: account ${custody.accountId.slice(0, 8)}…, minted ` +
          `${ago(custody.mintedAt)}. No password needed.`,
    );
  },
  (error: unknown) => {
    stage("worker failed", null, String(error));
    say(
      "custody",
      "The OPFS pool would not install. If another tab of this page — or of " +
        "/client-worker — is open, that is why: the handles are exclusive.",
    );
    document.title = "FAIL — key custody";
  },
);

// --- The cold half: a password login, whose last act is minting the wrap ------

async function runLogin(username: string, password: string): Promise<void> {
  const startedAt = performance.now();
  const summary = await client.login(username, password);
  const wallMs = round(performance.now() - startedAt);
  stage("total, click to first render", wallMs, "");

  mountPersonApp(client.core, clientGiftsPorts(client.core), summary.people);
  say(
    "verdict",
    [
      `Logged in the expensive way: Argon2id ${summary.argon2Ms} ms, ` +
        `pull(${summary.cursorBefore}) applied ${summary.applied} of ${summary.records} records.`,
      `Custody minted in ${summary.custody.ms} ms — ${summary.custody.extractability}.`,
      `Storage: ${summary.custody.storage}.`,
      "",
      "Now reload the page. The button will say “resume”, and nothing above " +
        "this line will happen again.",
    ].join("\n"),
  );
  document.title = `minted ${wallMs} ms — key custody`;
  show("resume-form", true);
  show("login", false);
}

// --- The warm half, which is the increment ------------------------------------

async function runResume(): Promise<void> {
  const startedAt = performance.now();
  const summary = await client.resume();
  const wallMs = round(performance.now() - startedAt);
  stage(
    "total, click to first render",
    wallMs,
    `no password, no Argon2id, ${summary.networkCalls} network calls`,
  );

  mountPersonApp(client.core, clientGiftsPorts(client.core), summary.people);

  // The done-when, as four conditions rather than a feeling.
  const offline = summary.networkCalls === 0 && summary.guardProven;
  const decrypted = summary.canary !== null && summary.canary.inStore;
  const rendered = summary.people.length > 0;
  const protectedKey = !summary.extractability.startsWith("⚠︎");
  const pass = offline && decrypted && rendered && protectedKey;

  say(
    "verdict",
    [
      `${pass ? "PASS" : "FAIL"} — a reload unwrapped the master key and decrypted a row, ` +
        `with no password and no relay.`,
      "",
      `${offline ? "✓" : "✗"} no network: ${summary.networkCalls} fetch calls during the resume — ` +
        `and the guard is real, because a deliberate probe fetch ` +
        `${summary.guardProven ? "was blocked" : "GOT THROUGH"}`,
      `${protectedKey ? "✓" : "✗"} the wrapping key is a handle, not a value: ${summary.extractability}`,
      summary.canary === null
        ? "✗ no canary in custody — log in once more to store one"
        : `${decrypted ? "✓" : "✗"} opened ${summary.canary.bytes} B of relay ciphertext from ` +
          `${summary.canary.table} → “${summary.canary.plaintext}”` +
          `${summary.canary.inStore ? ", the same row the OPFS store holds" : " — but the store does not hold it"}`,
      `${rendered ? "✓" : "✗"} rendered ${summary.people.length} people from OPFS through the same PersonScreen`,
      "",
      `cost: ${wallMs} ms end to end — unwrap ${summary.unwrapMs} ms, open the store ` +
        `${summary.openStoreMs} ms. The password was last typed ${ago(summary.mintedAt)}.`,
    ].join("\n"),
  );
  document.title = `${pass ? "PASS" : "FAIL"} ${wallMs} ms — key custody`;
  console.log(
    `key custody: resume ${wallMs} ms (unwrap ${summary.unwrapMs} ms, store ` +
      `${summary.openStoreMs} ms), ${summary.networkCalls} network calls, canary ` +
      `${summary.canary === null ? "absent" : summary.canary.plaintext}`,
  );
}

// --- Wiring -------------------------------------------------------------------

function fail(error: unknown): void {
  stage("failed", null, String(error));
  document.title = "FAIL — key custody";
  console.error(error);
}

document.getElementById("login")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const read = (id: string): string => {
    const field = document.getElementById(id);
    return field instanceof HTMLInputElement ? field.value : "";
  };
  runLogin(read("username"), read("password")).catch(fail);
});

document.getElementById("resume")?.addEventListener("click", () => {
  const button = document.getElementById("resume");
  if (button instanceof HTMLButtonElement) button.disabled = true;
  runResume().catch(fail);
});

// Custody without a way out is a browser you cannot log out of. Dropping the
// record drops the only reference to the `CryptoKey` handle with it.
document.getElementById("forget")?.addEventListener("click", () => {
  client.forget().then((message) => {
    stage("forgot the wrap", null, message);
    show("resume-form", false);
    show("login", true);
    say("custody", "The wrap is gone. The store is still there; the key is not.");
  }, fail);
});

document.getElementById("wipe")?.addEventListener("click", () => {
  client.wipe().then((files) => {
    stage(
      "wiped the OPFS pool and the wrap",
      null,
      `${files.length} files left — reload for a genuinely cold start`,
    );
  }, fail);
});
