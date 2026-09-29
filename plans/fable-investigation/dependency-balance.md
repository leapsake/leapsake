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

| Area                                           | Lines   | Direct third-party deps                                            |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `packages/*` (shipped in every client)         | ~33,000 | `zod`, `@noble/ciphers`, `@noble/hashes`, `@scure/bip39`, `fflate` |
| `apps/server` (shipped)                        | ~1,400  | `zod`, `proxy-addr`                                                |
| `scripts/` + `apps/desktop/scripts/` (tooling) | ~8,300  | none; `node:*` and `fetch` only                                    |
| `scripts/**/*.test.mjs`                        | ~3,300  | `vitest`                                                           |

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

1 through 7 landed; only 8 remains.

### 1. Cap the relay's request body, bound the limiter, answer malformed JSON with 400

**✅ Landed 2026-09-28.** Threat M4 in `apps/server/README.md`; `relay.test.ts` →
_relay request bodies_ holds it up.

### 2. `packages/bytes`: base64 and hex from `@scure/base`

**✅ Landed 2026-09-28.** The why is in `packages/bytes/README.md`; `base64.test.ts` pins the
stored format.

### 3. Remove `@stylistic/eslint-plugin`; move comment max-len into the local plugin

**✅ Landed 2026-09-28.** `leapsake/max-comment-width` in `scripts/lint/comment-rules.mjs`;
`comment-rules.test.mjs` → _max-comment-width_ holds it up.

### 4. `apps/website`: use Astro's zod, drop the direct dependency

**✅ Landed 2026-09-28.** `src/content.config.ts` imports `z` from `astro/zod`;
`test/site.test.ts` → _the docs model_ holds the schema up.

### 5. One React version, declared once, in a pnpm catalog

**✅ Landed 2026-09-29.** `pnpm-workspace.yaml` → `catalog:` pins React Native's embedded
renderer version; desktop's dedupe is gone and `pnpm test:bundle` holds it up
(`apps/desktop/README.md` → _One React, pinned in the catalog_).

### 6. `scripts/release/index.mjs`: `parseArgs` from `node:util`

**✅ Landed 2026-09-29.** `scripts/release/args.mjs`; `args.test.mjs` pins every documented
invocation and rejects an unknown flag.

### 7. Write down the rule for external binaries

**✅ Landed 2026-09-29.** `CONTRIBUTING.md` → _Testing_ → _Where each tier lives_, with both
scripts linked as its examples.

### 8. Retire the Hermes await-in-ternary scan if the engine has fixed it

`scripts/hermes-await-in-ternary.test.mjs` scans source for a shape Hermes miscompiled. Whether
the Hermes shipped with the pinned Expo SDK still does cannot be read from source. Do: on an iOS
simulator, a dev-client build with the shape reintroduced in a throwaway function that logs its
result; if the value is correct, delete the scan and its `vitest.config.ts` include; if not,
leave it and note the SDK version checked in the scan's header (a behaviour fact, under two
lines). Re-check on each Expo SDK bump until it goes.

## Not a step here: the mobile E2E harness

Audited and deliberately left alone: no library replaces what
`scripts/lib/mobile-harness.mjs` does, and the thing that would shrink it is a build choice, not
a dependency. The case and the measurements live in
[`ci-and-test-tiers.md`](./ci-and-test-tiers.md) step 4. **Do not restructure the harness under
this doc**, and do not re-audit it.

## Evaluated and kept, with the tripwire that reopens each

Each row was read, not assumed. Reopen a row only when its tripwire fires.

| Bespoke thing                                                                                                                               | Alternative weighed                                        | Why kept                                                                                                                                                                                                                                                            | Reopen when                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/release/apple-app-store-connect.mjs`, `google-play.mjs`, `targets/ios.mjs`, `targets/android.mjs` (~2,200 lines + ~1,800 of tests) | fastlane (`gym`, `pilot`, `deliver`, `supply`); EAS Submit | JWT signing is correct (ES256 with `ieee-p1363`, `aud`, `kid`; RS256 service-account exchange), retries honour `Retry-After`, every phase is tested. fastlane adds a Ruby toolchain and ~100 gems to every dev and CI environment; EAS adds an account and a cloud. | **The next store need is screenshots, localized metadata, or shared signing certificates.** Adopt fastlane then rather than growing `ios.mjs`; likely the macOS work in [`../desktop-packaging.md`](../desktop-packaging.md). |
| `packages/vcard` (~3,000 lines)                                                                                                             | `vcard4`, `ical.js`                                        | Round-trip tested, device-verified against iOS Contacts; `vcard4` is v4-only and the reader must accept 2.1/3.0 Apple exports. Input is a user-chosen file, so a parser defect is a bad import, not a network exploit.                                              | A vCard library appears that reads 2.1/3.0/4.0 and Apple's `item1.X-AB*` groups and passes `test/fixtures/` unchanged.                                                                                                        |
| `packages/holidays` recurrence + lunisolar tables                                                                                           | `date-holidays`                                            | Pure tables and arithmetic, no I/O, tested; the alternative is large and carries locale data this app never reads.                                                                                                                                                  | Islamic or Hindu/Buddhist calendars need computing rather than tabling.                                                                                                                                                       |
| `packages/schema/src/merge.ts` canonical JSON                                                                                               | `fast-json-stable-stringify`                               | Nine lines with one caller.                                                                                                                                                                                                                                         | A second caller.                                                                                                                                                                                                              |
| `packages/sync/src/http-transport.ts`                                                                                                       | `ky`, `ofetch`                                             | One retry rule (re-login on 401), tested.                                                                                                                                                                                                                           | A second retry policy.                                                                                                                                                                                                        |
| `scripts/test-all.mjs`, `set-version.mjs`, `release/version.mjs`                                                                            | turbo/nx; `semver`; changesets                             | Tested; each encodes a narrower grammar on purpose (blocked = exit 3; only `X.Y.Z-stage.N` versions).                                                                                                                                                               | The version grammar widens, or a third tool needs the tier registry.                                                                                                                                                          |
| `scripts/icons.mjs` (Homebrew librsvg + ImageMagick)                                                                                        | `sharp`, `@resvg/resvg-js`                                 | Both are native binaries in a repo already fighting one native ABI (`AGENTS.md`); regeneration runs only when artwork changes; `--check` is hash-only.                                                                                                              | The N-API exit in [`../v0-2.md`](../v0-2.md) lands and the ABI fight is over.                                                                                                                                                 |
| `scripts/lib/ensure-gitleaks.mjs`                                                                                                           | a Homebrew prerequisite                                    | Pinned version with per-platform checksums is the better supply-chain posture, and it is what makes `test:secrets` identical on a runner.                                                                                                                           | Never on its own; step 7 writes the rule down.                                                                                                                                                                                |
| `tsx` for the server's dev loop                                                                                                             | Node 24 native type stripping                              | Stripping needs `.ts` import specifiers; the server uses `.js`.                                                                                                                                                                                                     | The server's specifiers change for another reason.                                                                                                                                                                            |
| `apps/desktop/scripts/name-dev-bundle.mjs`                                                                                                  | nothing                                                    | A dev-only cosmetic stopgap its header says dies when packaging lands.                                                                                                                                                                                              | [`../desktop-packaging.md`](../desktop-packaging.md) lands: delete it.                                                                                                                                                        |
| `proxy-addr`, `fflate`, `react-router-dom`, `zod`, `@noble/*`, `@scure/bip39`                                                               | hand-rolling                                               | Each is small, focused, and doing exactly the job it was added for.                                                                                                                                                                                                 | Nothing foreseen.                                                                                                                                                                                                             |
