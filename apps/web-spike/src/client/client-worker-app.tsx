import { eventLoopLag } from "../measure.js";
import { createWorkerClient } from "./core-proxy.js";
import { clientGiftsPorts } from "./gifts-ports-client.js";
import { mountPersonApp } from "./person-app.js";
import type { Stage } from "./worker-protocol.js";

/**
 * **Increment 5c**: the same login as 5b, with the data layer one thread over
 * and the store in OPFS — so the page stays interactive throughout, and a reload
 * does not re-pull.
 *
 * This module is what is *left* on the main thread once `core-worker.ts` has
 * taken sqlite-wasm, Argon2id, the master key, the sync engine and `core`: a
 * form, a stage table, a frame meter, and React. That is the shape a real web
 * client would have.
 *
 * | | `/client` (5b) | `/client-worker` (here) |
 * | --- | --- | --- |
 * | Argon2id | the tab's main thread | the worker's |
 * | the store | `:memory:`, per tab | OPFS SAHPool, per account |
 * | `runMigrations` | every tab, 20–43 ms | once, ever |
 * | `pull` | `pull(0)`, every tab | `pull(cursor)` from `sync_state` |
 * | the screen | `person-app.tsx` | **the same file, imported** |
 *
 * ## The two done-whens, both measured on this page rather than argued
 *
 * 1. **Interactive throughout.** The meter below runs on this thread for the
 *    whole login: it counts frames, records the worst gap between them, and runs
 *    the same `eventLoopLag` probe 5b ran across Argon2id. 5b's reading was a
 *    ~800 ms stall on this thread; the worker's own probe still reports ~800 ms,
 *    and the pair is the finding — **the stall did not shrink, it moved.**
 * 2. **A reload does not re-pull.** The store is OPFS and the cursor is the
 *    durable `sync_state` row, so a second login reports `pull(<cursor>)` with 0
 *    applied. The KDF still runs on every load, because nothing here persists a
 *    key — that is 5e, and this page is the thing that makes the cost obvious.
 *
 * ## Three instruments, because a hidden tab breaks the first two
 *
 * Backgrounding a tab stops `requestAnimationFrame` entirely and clamps timers
 * to ~1 s, so in a hidden tab the frame meter reads *zero frames* and
 * `measure.ts`'s `setInterval` probe — the one that ported unchanged from Node
 * to the browser in 5b — reports a ~900 ms stall on a main thread that was
 * never blocked at all. Both are throttling, not blocking, and neither can tell
 * the difference.
 *
 * So the number the verdict is keyed off is a **`MessageChannel` ping-pong**:
 * the port posts to itself and measures the gap between consecutive deliveries.
 * Message tasks are not on the timer throttle, so it measures what it says it
 * measures whether or not anyone is looking at the tab — which matters here
 * beyond aesthetics, since every browser check this spike owes is "drive a tab
 * the user is not looking at."
 */

// --- The page's own furniture ------------------------------------------------

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

// --- The frame meter, which is this increment's instrument -------------------

/**
 * A `requestAnimationFrame` loop that never stops, recording how long the main
 * thread went between frames and animating something a human can watch.
 *
 * The worst gap is the measurement. A thread doing 19 MiB of Argon2id cannot
 * paint, so in 5b this number would have been the length of the KDF; if the
 * worker split works, it stays at one frame (~16 ms) throughout a login. It is
 * deliberately a *main-thread* instrument — nothing about it asks the worker
 * whether the worker was busy.
 */
const meter = {
  frames: 0,
  worstGapMs: 0,
  /** Frames and gap since `mark()` — i.e. across the login rather than the page. */
  windowFrames: 0,
  windowWorstMs: 0,
  everHidden: document.visibilityState === "hidden",
};

function markWindow(): void {
  meter.windowFrames = 0;
  meter.windowWorstMs = 0;
  meter.everHidden = document.visibilityState === "hidden";
}

const bar = document.getElementById("spinner");
let last = performance.now();
function frame(now: number): void {
  const gap = now - last;
  last = now;
  meter.frames += 1;
  meter.windowFrames += 1;
  meter.worstGapMs = Math.max(meter.worstGapMs, gap);
  meter.windowWorstMs = Math.max(meter.windowWorstMs, gap);
  if (document.visibilityState === "hidden") meter.everHidden = true;
  if (bar !== null) {
    // A moving bar rather than a number, because "the page is not frozen" is a
    // claim a screenshot should be able to carry.
    bar.style.transform = `translateX(${Math.round(120 * Math.abs(Math.sin(now / 600)))}px)`;
  }
  say(
    "meter",
    `${meter.frames} frames drawn · worst gap ${round(meter.worstGapMs)} ms · ` +
      `tab ${document.visibilityState}`,
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/**
 * Main-thread **task latency**: a `MessageChannel` posting to itself in a loop,
 * recording the worst gap between two deliveries.
 *
 * This is the instrument the verdict trusts, and it exists because the other two
 * cannot survive a backgrounded tab (see the docblock). A message task is
 * dispatched as soon as the thread is free, and — unlike `setTimeout` — is not
 * subject to the background-tab clamp, so the worst gap is the longest the main
 * thread was genuinely unavailable. On 5b's page that would be the length of an
 * Argon2id run; here it should be single-digit milliseconds.
 *
 * It reports a *distribution*, not just a worst case, and that is not padding:
 * the loop runs at a few hundred thousand round trips per second, which is
 * itself enough allocation to earn the occasional garbage-collection pause. So
 * a lone 50 ms sample is more likely the probe's own GC than the worker
 * blocking the page — `janky`, the count of gaps over one 60 Hz frame, is what
 * says whether the thread was *repeatedly* unavailable, and it is the number to
 * read if the worst case looks surprising.
 */
function taskLatency(): {
  stop: () => { worstMs: number; ticks: number; janky: number };
} {
  const channel = new MessageChannel();
  let previous = performance.now();
  let worst = 0;
  let ticks = 0;
  let janky = 0;
  let running = true;
  channel.port1.onmessage = (): void => {
    const now = performance.now();
    const gap = now - previous;
    worst = Math.max(worst, gap);
    if (gap > 16) janky += 1;
    previous = now;
    ticks += 1;
    if (running) channel.port2.postMessage(0);
  };
  channel.port2.postMessage(0);
  return {
    stop: () => {
      running = false;
      channel.port1.close();
      channel.port2.close();
      return { worstMs: round(worst), ticks, janky };
    },
  };
}

// Typing into the box during the login is the other half of "interactive", and
// the one a person can feel. It counts characters rather than echoing them so
// the password habit of typing into the wrong field costs nothing.
const echo = document.getElementById("echo");
echo?.addEventListener("input", (event) => {
  const field = event.target;
  if (field instanceof HTMLInputElement) {
    say("echo-count", `${field.value.length} characters, typed on a live main thread`);
  }
});

// --- The worker ---------------------------------------------------------------

/**
 * `new URL(..., import.meta.url)` is the form Vite understands, and `type:
 * "module"` matters twice: the worker imports `@leapsake/*` as ES modules, and a
 * classic worker could not `await` at the top level to install the VFS.
 */
const worker = new Worker(new URL("./core-worker.ts", import.meta.url), {
  type: "module",
  name: "leapsake-core",
});

const client = createWorkerClient(worker, (message: Stage) => {
  stage(message.label, message.ms, message.detail);
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
    say(
      "opfs",
      ready.files.length === 0
        ? "OPFS is empty — this load will pull the whole account."
        : `OPFS already holds ${held} — this load should pull nothing.`,
    );
  },
  (error: unknown) => {
    stage("worker failed", null, String(error));
    // Two causes, and the interesting one is not a bug: a second tab cannot take
    // the pool's access handles while the first tab's worker holds them.
    say(
      "opfs",
      "The OPFS pool would not install. If another tab of this page is open, " +
        "that is why — the handles are exclusive.",
    );
    document.title = "FAIL — worker client";
  },
);

// --- Login, on someone else's thread -----------------------------------------

async function run(username: string, password: string): Promise<void> {
  const startedAt = performance.now();
  markWindow();
  // Two probes on this thread. The first is the same one the worker runs on
  // itself — one instrument, two threads, and the difference between the
  // readings is the increment. The second is the one that still means something
  // when nobody is looking at the tab.
  const lag = eventLoopLag();
  const tasks = taskLatency();

  const summary = await client.login(username, password);
  const mainLagMs = await lag.stop();
  const { worstMs: taskWorstMs, ticks, janky } = tasks.stop();
  const wallMs = round(performance.now() - startedAt);

  // No `await paint()` anywhere above, and their absence is a result: 5b needed
  // four of them to get a row on screen before the next synchronous block, and
  // had to subtract the time they cost from its own total. Here the main thread
  // was never blocked, so nothing had to be yielded and nothing has to be
  // subtracted — the wall clock *is* the number.
  stage(
    "total, click to first render",
    wallMs,
    `worker did ${summary.totalMs} ms of it — no paint yields, nothing subtracted`,
  );

  mountPersonApp(client.core, clientGiftsPorts(client.core), summary.people);

  // --- The verdict, which is the done-when in one line ------------------------

  // Keyed off the task latency alone, because it is the only one of the three
  // that a hidden tab does not invalidate.
  const interactive = taskWorstMs < 100;
  const noRepull = summary.reusedStore
    ? summary.applied === 0
    : summary.applied > 0;
  const pass = interactive && noRepull;

  say(
    "verdict",
    [
      `main thread during the login: worst task latency ${taskWorstMs} ms over ` +
        `${ticks} message round trips, ${janky} of them over one 60 Hz frame ` +
        `— the numbers that decide this verdict`,
      `worker thread during the login: stalled ${summary.workerLagMs} ms ` +
        `(${summary.argon2LagMs} ms of it inside Argon2id, which cost ${summary.argon2Ms} ms)`,
      summary.reusedStore
        ? `reload: pull(${summary.cursorBefore}) applied ${summary.applied} of ` +
          `${summary.records} records — the OPFS store and its cursor survived`
        : `first run: pull(0) applied ${summary.applied} records → cursor ` +
          `${summary.cursorAfter}, now durable in sync_state`,
      meter.everHidden
        ? `⚠︎ the tab was hidden, so its two throttled instruments are void and ` +
          `say so: ${meter.windowFrames} frames drawn (rAF does not fire), ` +
          `${mainLagMs} ms worst timer lag (setInterval is clamped to ~1 s). ` +
          `Re-run with the window in front to read them.`
        : `and the two instruments a visible tab can also trust: ` +
          `${meter.windowFrames} frames drawn, worst gap ` +
          `${round(meter.windowWorstMs)} ms, worst timer lag ${mainLagMs} ms`,
    ].join("\n"),
  );

  document.title = `${pass ? "PASS" : "FAIL"} ${wallMs} ms — worker client`;
  console.log(
    `worker client: total ${wallMs} ms, main-thread worst task latency ` +
      `${taskWorstMs} ms (frame gap ${round(meter.windowWorstMs)} ms, timer lag ` +
      `${mainLagMs} ms, tab ${meter.everHidden ? "hidden" : "visible"}), ` +
      `worker stall ${summary.workerLagMs} ms, pull(${summary.cursorBefore}) → ` +
      `${summary.applied} applied`,
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
    stage("failed", null, String(error));
    document.title = "FAIL — worker client";
    console.error(error);
    if (button instanceof HTMLButtonElement) button.disabled = false;
  });
});

// The store now outlives the tab, so the spike needs a way back to a cold start
// — which is itself the increment's persistence claim, spelled as a button.
document.getElementById("wipe")?.addEventListener("click", () => {
  client.wipe().then(
    (files) => {
      stage(
        "wiped the OPFS pool",
        null,
        `${files.length} files left — reload for a cold start`,
      );
    },
    (error: unknown) => {
      stage("wipe failed", null, String(error));
    },
  );
});
