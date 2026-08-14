import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  type CoreApi,
  createCore,
  runMigrations,
  syncableRepos,
} from "@leapsake/core";
import { createHttpSyncTransport, createSyncEngine } from "@leapsake/sync";
import { MessagesProvider, en } from "@leapsake/ui/messages";
import { GiftsPortsProvider, PersonScreen, UiProvider } from "@leapsake/ui/web";
import type { GiftsPorts } from "@leapsake/ui/web";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapMasterKey } from "../bootstrap.js";
import { instrumentTransport } from "../measure.js";
import { ssrUiAdapter } from "../ui-adapter.js";
import { wasmSqliteDriver } from "../wasm-sqlite-driver.js";
import { clientGiftsPorts } from "./gifts-ports-client.js";

/**
 * **Increment 5b**: username and password in, a rendered person out, with every
 * step in between happening in this tab.
 *
 * 5a proved the browser can run the *data layer*. This is the whole client path
 * on top of it, and it is deliberately the SSR host's own pipeline with the
 * host removed:
 *
 * | | `/people/<id>` (SSR) | `/client` (here) |
 * | --- | --- | --- |
 * | Argon2id | `session.ts`, once per login, on the server | this tab's main thread |
 * | the store | `node:sqlite` `:memory:`, per request | `sqlite-wasm` `:memory:`, per tab |
 * | `pull(0)` + decrypt | the server | this tab |
 * | `PersonScreen` | `renderToString` | `createRoot` |
 * | the adapter | `ui-adapter.tsx` | **the same file, imported** |
 *
 * Four calls of `bootstrap.ts` — the *same module the server logs in with*, not
 * a browser copy of it — then `runMigrations`, `createSyncEngine(...).pull(0)`,
 * `createCore`, and the seven-call loader `routes/person.tsx` runs. What the
 * server keeps of a client session is nothing: it forwards `/relay/*` and
 * serves this module.
 *
 * ## Everything on the main thread, on purpose
 *
 * The tab freezes during Argon2id and that is the measurement, not a defect to
 * work around: **the number this page exists to produce is what a zero-knowledge
 * browser client costs before it can show anything**, and moving the KDF into a
 * Worker (5c) is only worth doing once the cost is known. `:memory:` for the
 * same reason — OPFS is 5c, and a red result here would otherwise have three
 * suspects.
 *
 * ## `:memory:` means the key and the store die with the tab
 *
 * There is no persistence and no key custody here: reload and you log in again.
 * That is 5d and 5e's subject, and the honest state of the browser today —
 * desktop and mobile wrap the master key with an OS enclave through `KeyStore`,
 * and §13 leaves the browser's equivalent open.
 */

// --- The stage table: what happened, in order, with what it cost -------------

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

/**
 * Yield long enough for the browser to paint.
 *
 * Needed because the next thing that runs is synchronous and blocks for a third
 * of a second: without this the "deriving key…" row is appended to a DOM that
 * has no chance to render until *after* the work it was announcing is over, so
 * the page would sit blank and then jump straight to the result. That is the
 * main-thread KDF cost in its most legible form — a client cannot even say it is
 * busy without deliberately yielding first.
 *
 * Two things about a hidden tab, both learned here and both worth keeping:
 * **`requestAnimationFrame` does not fire in one**, so a pipeline that awaits a
 * frame hangs indefinitely rather than running slowly — hence the timeout it is
 * raced against. And when the tab *is* visible but unfocused the frame is merely
 * slow, so the time spent yielding is accumulated and **subtracted from the
 * total**: it is the spike's own instrumentation, not the client's cost. Left
 * in, four yields turned a 530 ms login into a reported 12 423 ms.
 *
 * (Both matter beyond this page: the browser checks the spike still owes are all
 * "drive a tab the user is not looking at".)
 */
let yieldedMs = 0;

function paint(): Promise<void> {
  const started = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      yieldedMs += performance.now() - started;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(done, 0));
    setTimeout(done, 50);
  });
}

// --- The engine, awaited once, exactly as 5a does ---------------------------

const engineStarted = performance.now();
const sqlite3 = await sqlite3InitModule({
  print: console.log,
  printErr: console.error,
});
stage(
  "sqlite3InitModule",
  round(performance.now() - engineStarted),
  `sqlite ${sqlite3.version.libVersion}, 864 KiB of .wasm — per tab, not per login`,
);

// --- The loader, which is `routes/person.tsx`'s seven calls ------------------

/**
 * The person page's data, from `core` — the *same seven calls*, in the same
 * `Promise.all`, that `routes/person.tsx` makes on the server and
 * `personLoader` makes on desktop against `window.api`.
 *
 * Copied rather than imported for one reason: the SSR route wraps these in the
 * `WEB_SPIKE_LOADER=serial` attribution harness, which reads `process.env`. The
 * calls themselves are identical, and that they are is the finding — a third
 * host, a third transport under `CoreApi`, no reshaping.
 */
async function personProps(core: CoreApi, id: string) {
  const [
    view,
    mentionedIn,
    holidays,
    giftSuggestions,
    giftIdeaPool,
    giftsGiven,
    duplicateCandidates,
  ] = await Promise.all([
    core.views.person(id),
    core.reminders.mentioning("person", id),
    core.holidays.listForBearer("person", id),
    core.gifts.suggestions.listForRecipient("person", id),
    core.gifts.ideas.list(),
    core.gifts.given.listForRecipient("person", id),
    core.duplicates.findFor(id),
  ]);
  if (view === null) return null;
  return {
    view,
    mentionedIn,
    holidays,
    giftSuggestions,
    giftIdeaPool,
    giftsGiven,
    duplicateCount: duplicateCandidates.length,
  };
}

type PersonProps = Awaited<ReturnType<typeof personProps>>;

// --- The screen -------------------------------------------------------------

/**
 * `apps/desktop/src/renderer/src/screens/PersonView.tsx`, with its two
 * dependencies on being desktop replaced:
 *
 * - `useLoaderData()` → the loader called directly, since this client has no
 *   router (the framework question is still deliberately open);
 * - `useRevalidator()` → `load()` again, which is the same idea with none of the
 *   machinery. `onSetObserves` and `onChanged` are the two writes that do *not*
 *   go through a route action, and on the no-JS host they were no-ops with an
 *   apology in a comment. **Here they work**, because JavaScript runs.
 *
 * The `<select>` is the spike's, not the product's: there is no shared people
 * list (see `routes/people.tsx`), and one is not worth inventing to prove a
 * screen renders.
 */
function App(props: {
  core: CoreApi;
  people: readonly { id: string; label: string }[];
  first: string;
}): ReactElement {
  const { core, people, first } = props;
  const [id, setId] = useState(first);
  const [data, setData] = useState<PersonProps>(null);
  const [loaderMs, setLoaderMs] = useState<number | null>(null);

  const load = useCallback(
    async (personId: string): Promise<void> => {
      const started = performance.now();
      const next = await personProps(core, personId);
      setLoaderMs(round(performance.now() - started));
      setData(next);
    },
    [core],
  );

  useEffect(() => {
    void load(id);
  }, [load, id]);

  return (
    <>
      <p>
        <label htmlFor="who">Person</label>{" "}
        <select
          id="who"
          value={id}
          onChange={(event) => setId(event.target.value)}
        >
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.label}
            </option>
          ))}
        </select>{" "}
        <small>
          {people.length} people in the browser&rsquo;s store
          {loaderMs === null ? "" : ` — loader ${loaderMs} ms`}
        </small>
      </p>
      {data === null ? (
        <p>Loading…</p>
      ) : (
        <PersonScreen
          // Every `href` this screen renders is a link to the *SSR* host's
          // routes, and clicking one is a full document navigation that throws
          // this tab's store and master key away. That is not a bug in the
          // adapter, it is what the degenerate adapter *is* — see the findings.
          trail={[{ label: "People & Pets", href: "/client" }]}
          person={data.view.person}
          gender={data.view.gender}
          tags={data.view.tags}
          relationships={data.view.relationships}
          timeline={data.view.timeline}
          contactMethods={data.view.contactMethods}
          mentionedIn={data.mentionedIn}
          holidays={data.holidays}
          giftSuggestions={data.giftSuggestions}
          giftsGiven={data.giftsGiven}
          giftIdeaPool={data.giftIdeaPool}
          duplicateCount={data.duplicateCount}
          onSetObserves={(holidayId, observes) =>
            core.holidays.setObservers(holidayId, [
              { bearerType: "person", bearerId: id, observes },
            ])
          }
          onChanged={() => {
            void load(id);
          }}
        />
      )}
    </>
  );
}

function mount(
  core: CoreApi,
  ports: GiftsPorts,
  people: readonly { id: string; label: string }[],
): void {
  const host = document.getElementById("app");
  const first = people[0]?.id;
  if (host === null || first === undefined) return;

  // The identical provider stack `render.tsx` mounts for a server render — the
  // same three providers, the same adapter instance — with `renderToString`
  // replaced by a root. Nothing about `@leapsake/ui` needed to know which.
  createRoot(host).render(
    <MessagesProvider messages={en}>
      <UiProvider adapter={ssrUiAdapter}>
        <GiftsPortsProvider ports={ports}>
          <App core={core} people={people} first={first} />
        </GiftsPortsProvider>
      </UiProvider>
    </MessagesProvider>,
  );
}

// --- Login, pull, decrypt ---------------------------------------------------

async function run(username: string, password: string): Promise<void> {
  const startedAt = performance.now();
  yieldedMs = 0;

  stage("deriving the key…", null, "Argon2id, on this thread — the tab freezes");
  await paint();

  // The server's own login module, imported. `baseUrl: "/relay"` is a relative
  // URL, which the transport supports for free by never calling `new URL(base)`
  // — see `relay-proxy.ts` for why the browser cannot reach the relay directly.
  const { accountId, masterKey, authVerifier, argon2Ms, argon2LagMs } =
    await bootstrapMasterKey({ relayUrl: "/relay", username, password });
  stage(
    "Argon2id + bootstrap",
    argon2Ms,
    `main thread stalled ${argon2LagMs} ms — 19 MiB, t=2, in JavaScript, ` +
      // Not decoration: the same KDF measured ~1.9× slower in a hidden tab than
      // in a visible one, so a number without this label cannot be compared to
      // another. A hidden tab's renderer runs at a lower priority — the same
      // reason `requestAnimationFrame` stops firing in one.
      `tab ${document.visibilityState}`,
  );
  await paint();

  const migrateStarted = performance.now();
  const db = new sqlite3.oo1.DB(":memory:");
  const driver = wasmSqliteDriver(db);
  await runMigrations(driver);
  stage(
    "runMigrations",
    round(performance.now() - migrateStarted),
    ":memory:, so this is paid per tab until OPFS (5c)",
  );
  await paint();

  const transport = instrumentTransport(
    createHttpSyncTransport({ baseUrl: "/relay", accountId, authVerifier }),
  );
  const engine = createSyncEngine({
    transport,
    masterKey,
    repos: syncableRepos(driver),
  });

  const pullStarted = performance.now();
  const pulled = await engine.pull(0);
  const pullMs = round(performance.now() - pullStarted);
  const stats = transport.stats();
  stage(
    "pull(0) + decrypt + apply",
    pullMs,
    `${pulled.applied} applied / ${stats.records} records / ` +
      `${(stats.bytes / 1024).toFixed(1)} KiB — transport ${stats.transportMs} ms, ` +
      `decrypt + apply ${round(pullMs - stats.transportMs)} ms`,
  );
  await paint();

  const coreStarted = performance.now();
  const core = createCore(driver);
  const entities = await core.views.entityList();
  const people = entities
    .filter((row) => row.type === "person")
    .map((row) => ({ id: row.id, label: row.label }));
  stage("createCore + entityList", round(performance.now() - coreStarted), "");

  mount(core, clientGiftsPorts(core), people);
  const totalMs = round(performance.now() - startedAt - yieldedMs);
  stage(
    "total, click to first render",
    totalMs,
    `work only — ${round(yieldedMs)} ms of deliberate paint yields subtracted`,
  );

  // The done-when in one string, in the place a tab screenshot always shows.
  document.title = `PASS ${totalMs} ms — client login`;
  console.log(
    `client login: argon2 ${argon2Ms} ms (stall ${argon2LagMs} ms), ` +
      `pull ${pullMs} ms, ${stats.records} records, total ${totalMs} ms`,
  );
}

const form = document.getElementById("login");
form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const read = (id: string): string => {
    const field = document.getElementById(id);
    return field instanceof HTMLInputElement ? field.value : "";
  };
  const button = document.getElementById("go");
  if (button instanceof HTMLButtonElement) button.disabled = true;

  run(read("username"), read("password")).catch((error: unknown) => {
    // A wrong password fails at the relay's bootstrap check rather than at an
    // unwrap, so this is a 401 surfaced as a throw — same as the SSR login.
    stage("failed", null, String(error));
    document.title = "FAIL — client login";
    console.error(error);
    if (button instanceof HTMLButtonElement) button.disabled = false;
  });
});
