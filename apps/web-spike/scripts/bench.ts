/**
 * **The cold-vs-warm decision rule, as a number.**
 *
 * The spike doc's rule is stated on a p50: *"if cold's p50 is under ~150 ms at
 * realistic store size, take cold — it is simpler and the better privacy story."*
 * One request tells you nothing about a p50, so this logs in once and then walks
 * the read path N times over a live HTTP connection.
 *
 * ```sh
 * pnpm --filter @leapsake/web-spike bench --username ada --password 'hunter2 hunter2' --n 30
 * ```
 *
 * Run it against a host started with `WEB_SPIKE_STORE=cold` and again with
 * `warm` to get both arms. The login's Argon2id is deliberately **outside** the
 * measured loop — that is the point of the warm-key configuration, and burying a
 * once-per-session 355 ms inside a per-request p50 would misreport both.
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

const base = arg("base", "http://localhost:5180");
const username = arg("username");
const password = arg("password");
const runs = Number(arg("n", "30"));

const loginStarted = performance.now();
const login = await fetch(`${base}/login`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username, password }),
  redirect: "manual",
});
const loginMs = Math.round(performance.now() - loginStarted);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (cookie === undefined) throw new Error(`login failed: ${login.status}`);

async function get(
  path: string,
): Promise<{ ms: number; bytes: number; body: string }> {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, { headers: { cookie } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return { ms: performance.now() - started, bytes: body.length, body };
}

// The person page is the one worth timing: seven parallel core reads and the
// whole of `PersonScreen`, where the list is one read and a `<ul>`. The first
// link is Ada — the list sorts by label, and she is the seed's rich person.
const list = await get("/people");
const firstPerson = /href="(\/people\/[^"]+)"/.exec(list.body)?.[1];
if (firstPerson === undefined) throw new Error("no people on the list page");

function percentile(sorted: number[], p: number): number {
  const at = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return Math.round(sorted[at]! * 10) / 10;
}

async function bench(label: string, path: string): Promise<void> {
  await get(path); // warm the connection and, in warm mode, the store
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) samples.push((await get(path)).ms);
  samples.sort((a, b) => a - b);
  console.log(
    `${label.padEnd(10)} p50 ${String(percentile(samples, 0.5)).padStart(7)} ms   ` +
      `p90 ${String(percentile(samples, 0.9)).padStart(7)} ms   ` +
      `min ${String(percentile(samples, 0)).padStart(7)} ms   ` +
      `max ${String(percentile(samples, 1)).padStart(7)} ms`,
  );
}

console.log(`${base} — ${runs} requests each, after one login`);
console.log(`login      ${loginMs} ms   (Argon2id, once per session)`);
console.log(`list page  ${Math.round(list.bytes / 1024)} KiB`);
await bench("/people", "/people");
await bench("person", firstPerson);
console.log("");
console.log("Decision rule: cold's p50 under ~150 ms ⇒ take cold-per-request.");
