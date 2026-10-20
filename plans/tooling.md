# Tooling and CI — what is unbuilt

- **Release provenance.** An attestation over each release artifact, with host-neutral tooling
  only (no host attestation action), so it survives a move off GitHub.
- **Continuous alpha.** A scheduled `cut alpha` whenever `main` has moved, as a fourth workflow
  beside `.github/workflows/cut.yml`, if the owner wants one.
- **E2E flows that pass the admission rule but are not promoted**
  ([`apps/mobile/maestro/e2e/README.md`](../apps/mobile/maestro/e2e/README.md) → _What earns a
  flow here_). Promoting one is the owner's call. Search and reminder
  completion are not candidates: a broken one loses no data.
  - **Contact import.** Desktop drops a `.vcf` → review → import; mobile imports from the
    device's contacts. The one path that writes many records at once from data the app did not
    author; its real fidelity bugs came from importing hundreds of real contacts, not from a
    test. What is untested is the screen.
  - **Factory reset** → the confirm phrase → the app returns **in place** to a first-run
    Unauthenticated state, key store emptied, roster cleared. The arc's `factory-reset` subflow
    covers it incidentally.
  - **Sign out → sign back in** with the password, reopening the store.
  - **Rotate the recovery phrase** (once built): re-auth → new phrase → the old one no longer
    opens the store. Per device, since each keeps opening its own sidecar until it re-adopts.
- **Assert the key-store row on mobile** once `simctl keychain` gains a read verb or the harness
  a host-side keychain reader; today the catalog's custody table leaves that row unasserted.
- **Run the website's live check remotely.** `pnpm test:live` runs only by hand today
  ([`apps/website/README.md`](../apps/website/README.md) → _Deployment_). It belongs in its
  own `live.yml`, daily plus `workflow_dispatch`, **never in `ci.yml`**: Pages deploys from
  the same push that starts CI, so the check would race the deploy and fail on every site
  change. Install with the README's scoped `--ignore-scripts` command to skip Electron.
  Unknowns to settle on the first run: whether Cloudflare's bot protection challenges a
  hosted runner's address (every run would fail with nothing wrong), and whether Pages
  reports deployments back to GitHub, which would allow running after each deploy instead.

### Catch up with Expo SDK 56's patch releases

`pnpm exec expo install --check` in `apps/mobile` names ten packages behind what SDK 56
expects (`expo` 56.0.11 against ~56.0.22, and the `expo-*` modules and `react-native-screens`
with it). That is patch drift inside one SDK, and nothing is known to be broken by it. It is
not a one-command `expo install --fix`, because **the update moves all three patched packages**
off the exact versions their patches are keyed to ([`../patches/README.md`](../patches/README.md)),
and none of the three fixes is upstream yet (checked 2026-09-29):

| Patch                         | Moves to                                 | Upstream                                                   | Re-prove with                                                   |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `expo-modules-core@56.0.16`   | ~56.0.26 (via `expo`)                    | 56.0.27 still reads `pairs` unlocked                       | `apps/mobile/test/shared-object-race-selftest.ts`               |
| `expo-contacts@56.0.13`       | ~56.0.14                                 | 56.0.14 still constructs `ContactDate` unguarded           | by hand: an emulator birthday stored as `19900512` imports      |
| `react-native-screens@4.25.2` | ~4.26.0                                  | fixed in 4.28.0, beyond what SDK 56 accepts                | Android Flow 4's password act on hosted runners, many runs      |

**Do:** `expo install --fix`; for each patch, `pnpm patch` the new version, re-apply the hunk,
`pnpm patch-commit`, and rename the key in `patchedDependencies` and the README row (whose
_"Expo SDK 56 pins 4.25.2"_ becomes the new pin). Drop a patch instead only if its upstream
check above has turned. **Acceptance:** `expo install --check` clean; `pnpm install` applies all
three patches; the three proofs above pass; `pnpm ios` and the Android build run. Worth doing
beside the next SDK move if one comes first, since that re-keys the same three patches.

### The N-API exit from the SQLite ABI dance

**A watch-item, blocked upstream. Nothing to build yet** — this exists so the exit is recognised
the moment it becomes available instead of being re-derived. How the problem bites day to day,
and how to recover from it, is in [`../AGENTS.md`](../AGENTS.md) → _The native SQLite ABI_.

The desktop at-rest driver is a native module (`better-sqlite3-multiple-ciphers`) whose prebuilt
`.node` is compiled against a single `NODE_MODULE_VERSION`, and we load it from **two runtimes
with different ABIs** — Electron and Node (Vitest integration tests deliberately run against the
real production engine). One binary, two ABIs, so whichever ran last wins.
`scripts/ensure-sqlite-abi.mjs` papers over it. This is the cost knowingly accepted when at-rest
encryption overrode the native-module-free `node:sqlite` preference
([`@leapsake/crypto`](../packages/crypto/README.md) → _The at-rest doors_).

**The exit:** [better-sqlite3 v13](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)
(June 2026) rewrote the addon onto **Node-API**, which is ABI-stable across runtime versions —
one `.node` loads under both Node and Electron. That **deletes the problem class**, not mitigates
it.

**Why we cannot take it yet:** we depend on the encryption fork, not upstream, and it has not
rebased — `better-sqlite3-multiple-ciphers` is at **12.11.1** with no v13 branch, still shipping
per-ABI prebuilds. Switching to upstream is not an option: the fork _is_ the
`PRAGMA cipher`/`PRAGMA key` support the whole at-rest design rests on. It historically tracks
upstream releases, so this is _watch, then take_ — not a fork or a patch.

**When it lands:** bump to `^13`; delete `scripts/ensure-sqlite-abi.mjs`; strip its prefix from
the desktop `dev`/`start`/`rebuild` scripts and from `pnpm test`; re-check packaging (one
ABI-agnostic binary should _simplify_ asar unpacking); verify the cipher pragmas are unchanged
(`applyDatabaseKey`) and the driver contract passes on both runtimes with no rebuild step.
**Verification:** run `pnpm test` and the desktop app back-to-back in either order with no
rebuild between. Today that is exactly what fails. It also lifts the reason
`scripts/icons.mjs` needs Homebrew: with one ABI, `sharp` or `@resvg/resvg-js` can render
the icons instead of librsvg and ImageMagick.

**Non-scope: mobile.** `apps/mobile` uses `expo-sqlite` (SQLCipher path), a native module
compiled by RN's own toolchain — no `NODE_MODULE_VERSION`, never shared a binary with desktop.
