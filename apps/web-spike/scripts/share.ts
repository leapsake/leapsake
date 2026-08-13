import { gzipSync } from "node:zlib";
import { createContext, runInContext } from "node:vm";
import react from "@vitejs/plugin-react";
import { build, type Rollup } from "vite";
import { decodeShare } from "../src/client/share.js";

/**
 * **Increment 4's done-when, as a runnable script.** Both sharing flavors, made
 * and viewed, with the three things §11 promises checked rather than asserted:
 *
 * 1. a capability link's key **never reaches the server** — shown by the request
 *    line the server actually received;
 * 2. the ciphertext it serves **contains no plaintext**, and decrypts with the
 *    key from the fragment;
 * 3. a hosted link **renders identically with JavaScript on and off**, which for
 *    a page carrying no `<script>` at all is a property of the markup.
 *
 * ```sh
 * pnpm --filter @leapsake/web-spike share \
 *   --host http://localhost:5180 --username ada --password 'hunter2 hunter2'
 * ```
 *
 * ## The browser-shaped gap, named up front
 *
 * No headless browser will launch in this dev shell (Increments 2 and 3 hit the
 * same wall), so "decrypts in-browser" is proved in two halves that together
 * leave only the browser itself unexercised:
 *
 * - the client entry is **built by Vite for a browser target** — the real
 *   `@leapsake/crypto` and `@leapsake/bytes`, bundled as a browser client would
 *   bundle them — and the output is checked for any surviving bare or `node:`
 *   import, which is what a package that secretly needed Node would leave behind;
 * - that **built bundle is then executed**, against a hand-written DOM stub and
 *   the same fragment a browser would put in `location.hash`, and its output is
 *   read back out of the stub.
 *
 * What that does not cover is the browser's own URL handling, which is the half
 * that matters most for a capability link. It is on the manual-check list beside
 * the Firefox `javascript.enabled=false` walk-through the earlier increments owe.
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

const hostUrl = arg("host", "http://localhost:5180").replace(/\/$/, "");
const username = arg("username");
const password = arg("password");

const pass: boolean[] = [];
function check(label: string, ok: boolean, detail: string): void {
  pass.push(ok);
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${detail}`);
}

// ---------------------------------------------------------------------------
// The web client, driven exactly as a no-JS browser drives it (roundtrip.ts).
// ---------------------------------------------------------------------------

let cookie = "";

async function web(
  method: "GET" | "POST",
  path: string,
  form?: Record<string, string>,
): Promise<{ status: number; headers: Headers; body: string }> {
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
    headers: response.headers,
    body: await response.text(),
  };
}

// --- Make one share of each flavor -----------------------------------------

const login = await web("POST", "/login", { username, password });
if (login.status !== 303) throw new Error(`login failed: ${login.status}`);

const chooser = await web("GET", "/share/new");
const relationshipId = /name="relationship" value="([^"]+)"/.exec(
  chooser.body,
)?.[1];
if (relationshipId === undefined) {
  throw new Error(
    "no relationship to share — re-seed the account (`pnpm --filter @leapsake/web-spike seed`)",
  );
}
console.log(`sharing relationship ${relationshipId}`);

/** The created link, pulled out of the page that shows it once. */
async function makeShare(flavor: "capability" | "hosted"): Promise<string> {
  const created = await web("POST", "/share/new", {
    relationship: relationshipId as string,
    flavor,
  });
  const link = /<code>([^<]+)<\/code>/.exec(created.body)?.[1];
  if (link === undefined) throw new Error(`no ${flavor} link in the response`);
  return link;
}

// ---------------------------------------------------------------------------
// 1. The capability link
// ---------------------------------------------------------------------------

console.log("\ncapability link — the key stays in the browser");

const capabilityLink = await makeShare("capability");
const [capabilityPath, fragment] = capabilityLink
  .slice(hostUrl.length)
  .split("#") as [string, string];

// `fetch` is used here in place of a browser deliberately: both implement the
// same rule from the same spec — the Fetch standard builds a request from a URL
// with its fragment already excluded — so this is the rule under test, not a
// convenience. The full link goes in, fragment and all.
const viewer = await fetch(capabilityLink, { redirect: "manual" });
const viewerBody = await viewer.text();
const received = viewer.headers.get("x-received-url") ?? "";

check(
  "the server's request line carries no fragment",
  !received.includes("#") && !received.includes(fragment) && received !== "",
  `sent ${capabilityPath}#${fragment.slice(0, 8)}…  received ${received}`,
);

// The payload's own words, which must not appear in what the server served.
const plaintextProbe = decodeShare(
  /data-blob="([^"]+)"/.exec(viewerBody)?.[1] ?? "",
  fragment,
);
const secrets = [
  plaintextProbe.title,
  ...plaintextProbe.partners.map((partner) => partner.label),
];

/**
 * A share title is `"A & B"`, which React writes as `A &amp; B` — so a page that
 * *did* leak it would not match a raw substring search. Both spellings are
 * checked on both sides, since a check that a leak cannot trip is not a check.
 */
const escaped = secrets.map((secret) =>
  secret.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
);

check(
  "the served page contains ciphertext and no plaintext",
  [...secrets, ...escaped].every((secret) => !viewerBody.includes(secret)),
  `${viewerBody.length} B page, none of [${secrets.join(", ")}] in it`,
);

check(
  "and it decrypts with the key from the fragment",
  plaintextProbe.partners.length === 2 && plaintextProbe.title.includes("&"),
  `"${plaintextProbe.title}", ${plaintextProbe.partners.length} partners, ` +
    `${plaintextProbe.milestones.length} milestones`,
);

// Without the fragment the same page is inert — the point of the flavor, and
// the reason the no-JS floor cannot reach it.
const noJs = await fetch(`${hostUrl}${capabilityPath}`);
const noJsBody = await noJs.text();
check(
  "without JavaScript it says so, rather than appearing broken",
  noJsBody.includes("<noscript>") && noJsBody.includes("needs JavaScript"),
  "the page names the reason: the key never reaches the server",
);

// ---------------------------------------------------------------------------
// 2. The client bundle: built for a browser, then run
// ---------------------------------------------------------------------------

console.log("\nthe client half — built by Vite, then executed");

const appRoot = new URL("..", import.meta.url).pathname;

/** One browser-target build, in memory. Returns the JS chunks it produced. */
async function bundle(
  entry: string,
  format: "iife" | "es",
): Promise<Rollup.OutputChunk[]> {
  const result = (await build({
    configFile: false,
    root: appRoot,
    logLevel: "error",
    plugins: [react()],
    // React reads it, and lib mode does not substitute it for you — left
    // undefined the bundle would reference `process` in a browser.
    define: { "process.env.NODE_ENV": '"production"' },
    build: {
      write: false,
      lib: {
        entry,
        formats: [format],
        name: "ShareClient",
        fileName: () => "bundle.js",
      },
      rollupOptions: { external: [] },
    },
    // One output per format, and Vite hands back an array whenever it built
    // through its multi-output path — normalized rather than indexed blindly.
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  return (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .filter((chunk): chunk is Rollup.OutputChunk => chunk.type === "chunk");
}

/** Minified and gzipped — the second number is the one a phone waits for. */
function weigh(code: string): string {
  const raw = (Buffer.byteLength(code) / 1024).toFixed(1);
  const gzip = (gzipSync(Buffer.from(code)).byteLength / 1024).toFixed(1);
  return `${raw} KiB min, ${gzip} KiB gzip`;
}

const cryptoChunks = await bundle("src/client/share.ts", "iife");
const clientCode = cryptoChunks.map((chunk) => chunk.code).join("\n");

check(
  "@leapsake/crypto compiles to a browser target",
  cryptoChunks.length > 0 &&
    !/(^|[^.\w])require\s*\(/.test(clientCode) &&
    !/["']node:/.test(clientCode),
  `${weigh(clientCode)}, no node: imports, no require()`,
);

/** The smallest DOM the client entry can be judged against. */
interface StubElement {
  tagName: string;
  textContent: string;
  attributes: Record<string, string>;
  children: StubElement[];
  getAttribute(name: string): string | null;
  appendChild(child: StubElement): void;
}

function element(tagName: string, attributes: Record<string, string> = {}): StubElement {
  const node: StubElement = {
    tagName,
    textContent: "",
    attributes,
    children: [],
    getAttribute: (name) => node.attributes[name] ?? null,
    appendChild: (child) => {
      node.children.push(child);
    },
  };
  return node;
}

function allText(node: StubElement): string {
  return [node.textContent, ...node.children.map(allText)].join(" ");
}

const ciphertextAttribute = /data-blob="([^"]+)"/.exec(viewerBody)?.[1] ?? "";

/**
 * Run the built bundle against the stub, with the fragment a browser would have
 * put in `location.hash`. Everything in the context is a **browser** global —
 * nothing from Node is exposed, so anything the bundle needed beyond this list
 * would fail here exactly as it would in a browser.
 */
function runClient(hash: string): { host: StubElement; status: StubElement } {
  const host = element("div", { "data-blob": ciphertextAttribute });
  const status = element("p");
  const byId: Record<string, StubElement> = { share: host, "share-status": status };
  runInContext(
    clientCode,
    createContext({
      console,
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      location: { hash },
      document: {
        getElementById: (id: string) => byId[id] ?? null,
        createElement: (tagName: string) => element(tagName),
      },
    }),
  );
  return { host, status };
}

const good = runClient(`#${fragment}`);
check(
  "the built bundle decrypts from location.hash and writes the DOM",
  good.status.textContent.startsWith("Decrypted in your browser") &&
    secrets.every((secret) => allText(good.host).includes(secret)),
  `status "${good.status.textContent}"`,
);

// A wrong key must fail closed rather than render something.
const wrong = runClient(`#${"A".repeat(fragment.length)}`);
check(
  "a wrong key fails closed",
  wrong.status.textContent === "That key does not open this link." &&
    wrong.host.children.length === 0,
  "AEAD authentication rejects it; nothing renders",
);

// And no key at all is the forwarded-without-the-hash case.
const bare = runClient("");
check(
  "no key at all explains itself",
  bare.status.textContent.includes("missing its key") &&
    bare.host.children.length === 0,
  "the page a link stripped of its fragment shows",
);

// The Increment 5 early warning, bought for the price of one extra build.
try {
  const uiChunks = await bundle("src/client/share-screen.tsx", "es");
  const uiCode = uiChunks.map((chunk) => chunk.code).join("\n");
  check(
    "@leapsake/ui + React compile to a browser target too",
    uiChunks.length > 0 && !/["']node:/.test(uiCode),
    `${weigh(uiCode)} with RelationshipScreen (vs ${weigh(clientCode)} for crypto alone)`,
  );
} catch (error) {
  check("@leapsake/ui + React compile to a browser target too", false, String(error));
}

// ---------------------------------------------------------------------------
// 3. The hosted link
// ---------------------------------------------------------------------------

console.log("\nhosted link — the server holds the key, so no-JS works");

const hostedLink = await makeShare("hosted");
const hosted = await fetch(hostedLink);
const hostedBody = await hosted.text();

check(
  "no fragment, so the whole link is what the server receives",
  !hostedLink.includes("#"),
  hostedLink,
);

check(
  "it renders the shared relationship through the shared screen",
  escaped.every((secret) => hostedBody.includes(secret)),
  `${hostedBody.length} B page, all of [${secrets.join(", ")}] in it`,
);

// Increment 2's argument, reused because it is the same argument: a response
// with no `<script>` and no inline handler builds the same DOM either way, so
// "identical with JS on and off" is a property of the bytes.
check(
  "identical with JavaScript on and off",
  !/<script/i.test(hostedBody) && !/\son[a-z]+=/i.test(hostedBody),
  "no <script>, no inline handler — the DOM cannot differ",
);

check(
  "the two flavors differ by exactly one thing: who has the key",
  /<script/i.test(viewerBody) && !/<script/i.test(hostedBody),
  "capability ships a script and no plaintext; hosted ships plaintext and no script",
);

console.log(
  `\n${pass.every(Boolean) ? "PASS" : "FAIL"} — ${pass.filter(Boolean).length}/${pass.length} checks`,
);
process.exit(pass.every(Boolean) ? 0 : 1);
