# Dependency balance: where bespoke code becomes a dependency, and the reverse

**Decision (owner, 2026-09-19).** The repo leans first-party harder than most JS/TS apps, and
should keep doing so, but not past the point where bespoke code carries more defect and
vulnerability risk than a battle-tested dependency would. The rule stays the one in `AGENTS.md`:
add a dependency only when it pays for itself, and say why where it lands. This doc records an
audit against that rule and the steps it produced.

**Written to be read cold.** Each step is one agent's unit of work, lands as one or two commits,
and leaves `pnpm test` green. The verdicts below are recorded so no step re-audits; the
"evaluated and kept" table exists so nobody re-litigates a keep without its tripwire firing.
**Delete this doc when the last step lands**; move anything durable next to the code.

**Read first:** [`../../AGENTS.md`](../../AGENTS.md) → _Principles_ (the dependency rule, the
comment rule), this directory's [`README.md`](./README.md) → _Rules that apply to every
workstream_, and [`../../packages/README.md`](../../packages/README.md) → _These packages run on
the Hermes floor_ (why a shipped dependency must be pure JS).

---

## The verdict, so no step re-audits

Measured 2026-09-19, non-test lines, third-party packages declared directly:

| Area                                            | Lines   | Direct third-party deps                                                    |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `packages/*` (shipped in every client)          | ~33,000 | `zod`, `@noble/ciphers`, `@noble/hashes`, `@scure/bip39`, `fflate`         |
| `apps/server` (shipped)                         | ~1,400  | `zod`, `proxy-addr`                                                        |
| `scripts/` + `apps/desktop/scripts/` (tooling)  | ~8,300  | none; `node:*` and `fetch` only                                            |
| `scripts/**/*.test.mjs`                         | ~3,300  | `vitest`                                                                   |

- **Production is about right.** The shipped set is audited crypto, one schema library, one
  zip codec, and the platforms (Expo, React Native, Electron, Astro). Nothing in `packages/*`
  reimplements a library except the base64/hex codec (step 2).
- **The bespoke weight is in `scripts/`,** and most of it drives other people's tools
  (Xcode, App Store Connect, the Play API, simulators, Maestro, Metro) rather than reinventing
  libraries. The two API clients are tested and correct; the largest untested file is the mobile
  E2E harness, and its cost is a process choice, not a missing library (see _Not a step here_).
- **The one defect found is in shipped, hand-rolled code:** the relay reads request bodies with
  no size cap (step 1). It is the failure class the owner was worried about, and its fix is
  twenty lines, not a framework.

## Steps, each a commit

Order: 1 first, because it is a live vulnerability. 2 through 7 are independent of each other
and of 1.

### 1. Cap the relay's request body, bound the limiter, answer malformed JSON with 400

`readBody` in `apps/server/src/relay.ts` concatenates the whole body with no cap; the Caddyfile
sets no `request_body` limit; in-process TLS mode (Option B) has no proxy at all. The per-IP
limiter's `Map` never evicts an entry, so a source cycling addresses grows it without bound. A
body that is not JSON throws inside `handle` and surfaces as a 500.

Do, in `apps/server`:

- A `MAX_BODY_BYTES` constant in `config.ts`. Measure the largest legitimate `/sync/push` first
  (a full first push of a populated store, through `packages/sync`'s engine) and set the cap at
  several times that; a cap is a defence, not a budget. Refuse on `content-length` when it is
  present, and abort the stream at the cap when it is not; both answer **413**.
- Parse the body inside a `try` and answer **400** `{ error: "invalid request" }` on a parse
  failure, the same body the schema failures already send.
- Evict expired limiter entries: a sweep of the `Map` on each call once it passes a size
  threshold is enough for a single-node relay; no timer, nothing to stop on shutdown.
- `request_body { max_size … }` in the Caddyfile at the same figure, so Option A refuses before
  the relay sees the bytes.

Acceptance, in `apps/server/test/relay.test.ts`, black-box over `fetch` like the rest of that
file: a body one byte over the cap answers 413 on every POST route; a non-JSON body answers 400;
a limited IP is allowed again after the window (fake timers), which is the only observable the
eviction may change. Update `apps/server/README.md` → _Threat register_ with the new bound.

**Not a framework.** Hono would supply `bodyLimit` and routing with no transitive packages, and
is the right move if the relay grows past its nine routes or needs middleware a second time.
Today the fix is smaller than the import.

### 2. `packages/bytes`: base64 and hex from `@scure/base`

`@scure/base` is already in `node_modules` as a dependency of `@scure/bip39`, so declaring it
adds zero packages; it is from the same audited family as the crypto already trusted, pure JS on
Hermes, and exports `base64`, `base64url`, `hex`, and `utf8`. It replaces the hand-rolled codec
that sits under every ciphertext and stored secret.

Do: declare `@scure/base` in `packages/bytes/package.json` with the why in its `README.md`
(the AGENTS rule); reimplement `bytesToBase64`/`base64ToBytes` over `base64` and
`bytesToHex`/`hexToBytes` over `hex`; keep every exported name and signature; keep
`deterministicUuid` and the `utf8ToBytes`/`bytesToUtf8` re-exports as they are.

**Stored formats must not change.** Standard alphabet, padded; lowercase hex. The wire payloads,
`keystore.json`, and `expo-secure-store` values are all encoded by this package and read back by
older builds of the same package.

Acceptance: `packages/bytes/test/base64.test.ts` passes unchanged, including the rejection
cases (`@scure/base` throws on malformed input; confirm the messages the tests assert, or loosen
the assertions to "throws"). Add one fixture test pinning a few known byte strings to their exact
encoded output so a future codec swap cannot drift the format silently.

### 3. Remove `@stylistic/eslint-plugin`; move comment max-len into the local plugin

The plugin is loaded through oxlint's JS-plugin bridge for exactly one rule, `max-len` with
`code: 1000`, i.e. comments only. `scripts/lint/comment-rules.mjs` already walks every comment
for `max-comment-lines`, so a `max-comment-width` rule (80 columns, `ignoreUrls`, the
`oxlint-disable` pattern exempt) belongs beside it.

Do: add the rule and its cases to `scripts/lint/comment-rules.test.mjs`; swap the rule name in
`.oxlintrc.json` and `scripts/lint/comment-rules.oxlintrc.json`; remove the dependency and let
the lockfile shrink. Acceptance: `pnpm lint` reports the same findings on the same lines before
and after; `pnpm test:lint` is green; the package is gone from `pnpm-lock.yaml`.

### 4. `apps/website`: use Astro's zod, drop the direct dependency

Astro 7 depends on zod 4 and exports it at `astro/zod`. A separate direct copy can resolve to a
different instance than the one `astro:content` validates with. Do: import `z` from `astro/zod`
in `src/content.config.ts`, remove `zod` from `apps/website/package.json`. Acceptance:
`pnpm --filter @leapsake/website typecheck`, `pnpm test:docs`, and the website test file are
green; the site builds.

### 5. One React version, declared once, in a pnpm catalog

Root and mobile pin `react` 19.2.3; desktop pins 19.2.7. `apps/desktop/scripts/check-single-react.mjs`
exists to catch the symptom (two Reacts in the renderer bundle); a `catalog:` in
`pnpm-workspace.yaml` removes the cause. Expo's `bundledNativeModules.json` names 19.2.3 for
this SDK, and Expo is the stricter consumer, so **the catalog pins what Expo names**; check with
`pnpm exec expo install --check` in `apps/mobile` before choosing.

Do: `catalog:` entries for `react`, `react-dom`, `@types/react`, `@types/react-dom`; every
workspace `package.json` that lists them uses `catalog:`. Keep `check-single-react.mjs`: it also
catches a bundler dedupe mistake, which a catalog cannot. Acceptance: `pnpm install` changes
nothing but the pins; `pnpm test:bundle` is green; `pnpm ios` still builds.

### 6. `scripts/release/index.mjs`: `parseArgs` from `node:util`

The hand-rolled `parseArgs` at the top of the file is the one thing in `scripts/` with a direct
platform replacement (the file already uses `process.loadEnvFile`, the same instinct). Do:
replace it with `parseArgs` from `node:util` using `allowPositionals`, declaring the
`VALUE_FLAGS` as `type: "string"` and the rest as `type: "boolean"`; keep the `--flag=value` and
`--flag value` forms both working. Acceptance: `scripts/release/*.test.mjs` green;
`pnpm release --help` prints the same text; each documented invocation in `CONTRIBUTING.md` →
_Versioning and releases_ parses to the same `{ positional, flags, values }`.

### 7. Write down the rule for external binaries

Two conventions exist and neither is written down: `scripts/icons.mjs` requires Homebrew's
`rsvg-convert` and `magick` and refuses without them; `scripts/lib/ensure-gitleaks.mjs`
downloads a pinned, checksummed `gitleaks`. Both are right for what they do, so the rule is the
line between them: **a tool a test tier needs is fetched pinned and checksummed, so the tier is
the same on every machine and runner; a tool only a regeneration script needs may be a Homebrew
prerequisite, with a `--check` that needs nothing.** Do: one paragraph in `CONTRIBUTING.md` →
_Testing_, and nothing else; both scripts already obey it.

### 8. Retire the Hermes await-in-ternary scan if the engine has fixed it

`scripts/hermes-await-in-ternary.test.mjs` scans source for a shape Hermes miscompiled. Whether
the Hermes shipped with the pinned Expo SDK still does cannot be read from source. Do: on an iOS
simulator, a dev-client build with the shape reintroduced in a throwaway function that logs its
result; if the value is correct, delete the scan and its `vitest.config.ts` include; if not,
leave it and note the SDK version checked in the scan's header (a behaviour fact, under two
lines). Re-check on each Expo SDK bump until it goes.

## Not a step here: the mobile E2E harness

`scripts/lib/mobile-harness.mjs` is the largest bespoke file (about 1,500 lines), has no tests,
and roughly a third of it exists to drive an Expo dev client: waiting on Metro, settling the dev
menu, deep-linking past the launcher. No library replaces that; a release-configuration build
deletes it. That is [`ci-and-test-tiers.md`](./ci-and-test-tiers.md) step 4, an open decision
this audit adds evidence to. **Do not restructure the harness under this doc.**

## Evaluated and kept, with the tripwire that reopens each

Each row was read, not assumed. Reopen a row only when its tripwire fires.

| Bespoke thing                                                            | Alternative weighed                        | Why kept                                                                                                                                                                                       | Reopen when                                                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/release/asc.mjs`, `play.mjs`, `targets/ios.mjs`, `targets/android.mjs` (~2,200 lines + ~1,800 of tests) | fastlane (`gym`, `pilot`, `deliver`, `supply`); EAS Submit | JWT signing is correct (ES256 with `ieee-p1363`, `aud`, `kid`; RS256 service-account exchange), retries honour `Retry-After`, every phase is tested. fastlane adds a Ruby toolchain and ~100 gems to every dev and CI environment; EAS adds an account and a cloud. | **The next store need is screenshots, localized metadata, or shared signing certificates.** Adopt fastlane then rather than growing `ios.mjs`; likely the macOS work in [`../desktop-packaging.md`](../desktop-packaging.md). |
| `packages/vcard` (~3,000 lines)                                          | `vcard4`, `ical.js`                        | Round-trip tested, device-verified against iOS Contacts; `vcard4` is v4-only and the reader must accept 2.1/3.0 Apple exports. Input is a user-chosen file, so a parser defect is a bad import, not a network exploit. | A vCard library appears that reads 2.1/3.0/4.0 and Apple's `item1.X-AB*` groups and passes `test/fixtures/` unchanged.                                              |
| `packages/holidays` recurrence + lunisolar tables                        | `date-holidays`                            | Pure tables and arithmetic, no I/O, tested; the alternative is large and carries locale data this app never reads.                                                                              | Islamic or Hindu/Buddhist calendars need computing rather than tabling.                                                                                              |
| `packages/schema/src/merge.ts` canonical JSON                            | `fast-json-stable-stringify`               | Nine lines with one caller.                                                                                                                                                                    | A second caller.                                                                                                                                                     |
| `packages/sync/src/http-transport.ts`                                    | `ky`, `ofetch`                             | One retry rule (re-login on 401), tested.                                                                                                                                                       | A second retry policy.                                                                                                                                               |
| `scripts/test-all.mjs`, `set-version.mjs`, `release/version.mjs`         | turbo/nx; `semver`; changesets             | Tested; each encodes a narrower grammar on purpose (blocked = exit 3; only `X.Y.Z-stage.N` versions).                                                                                           | The version grammar widens, or a third tool needs the tier registry.                                                                                                 |
| `scripts/icons.mjs` (Homebrew librsvg + ImageMagick)                     | `sharp`, `@resvg/resvg-js`                 | Both are native binaries in a repo already fighting one native ABI (`AGENTS.md`); regeneration runs only when artwork changes; `--check` is hash-only.                                          | The N-API exit in [`../v0-2.md`](../v0-2.md) lands and the ABI fight is over.                                                                                        |
| `scripts/lib/ensure-gitleaks.mjs`                                        | a Homebrew prerequisite                    | Pinned version with per-platform checksums is the better supply-chain posture, and it is what makes `test:secrets` identical on a runner.                                                       | Never on its own; step 7 writes the rule down.                                                                                                                       |
| `tsx` for the server's dev loop                                          | Node 24 native type stripping              | Stripping needs `.ts` import specifiers; the server uses `.js`.                                                                                                                                 | The server's specifiers change for another reason.                                                                                                                   |
| `apps/desktop/scripts/name-dev-bundle.mjs`                               | nothing                                    | A dev-only cosmetic stopgap its header says dies when packaging lands.                                                                                                                          | [`../desktop-packaging.md`](../desktop-packaging.md) lands: delete it.                                                                                               |
| `proxy-addr`, `fflate`, `react-router-dom`, `zod`, `@noble/*`, `@scure/bip39` | hand-rolling                          | Each is small, focused, and doing exactly the job it was added for.                                                                                                                             | Nothing foreseen.                                                                                                                                                    |
