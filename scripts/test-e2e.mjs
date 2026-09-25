// The mobile E2E tier: the crucial-flow catalog
// (`plans/testing/crucial-flows.md`) driven through the real UI on a booted device.
//
// This is what `pnpm test:e2e` runs. It is a *sibling* of `test-native.mjs`, not a
// caller of the orchestrator: `test:e2e` used to be `test-all --only=e2e`, which with
// the tier's own script set to `test:e2e` would have spawned itself forever the moment
// the tier stopped being `blocked`. The same loop `test-native.mjs` avoids, for the same
// reason. `scripts/test-all.mjs` runs this per platform and maps the exit code.
//
// **What separates this tier from `test:native`** is not the harness — that is shared,
// in `lib/mobile-harness.mjs` — but the shape of what it runs. The self-test is one flow
// reporting one token. This is an ordered **arc**: Flow 1 resets the app and asserts a
// first run, Flow 2 fills it, Flow 4 converts what Flow 2 made. They share app state
// by design (the catalog takes 1→4 as one arc), so the harness stops the platform at the
// first red flow rather than reporting three failures that are really one.
//
// **The bar this meets is the `beta` rung plus the reachable custody assertions** — every
// flow on-screen, Flow 4's two door acts included (the rung table's `beta` bar, `CONTRIBUTING.md` →
// *The E2E release gate*), and the out-of-band half of Flows 1 and 4, which are `rc`'s. What `rc` still owes is
// the **key-store row**, deferred for want of a read verb
// (`lib/custody-assertions.mjs` → `KEY_STORE_NOTE`), and turning the catalog requirement in
// `scripts/release/targets/ios.mjs` into a `requires:` check. Flows 6/7a ship with sync.
//
// **The custody assertions are why a `flow()` may carry a third argument.** Every Maestro
// assertion reads the screen, so a build that encrypted nothing would pass all of them;
// those two functions read the bytes instead. They are iOS-only today — Android's `wipe` is
// `pm clear`, which hands back no container path, so it prints that it did not assert.
import { join } from "node:path";

import {
  custodyAuthenticated,
  custodyUnauthenticated,
} from "./lib/custody-assertions.mjs";
import { MAESTRO_DIR, runSuite } from "./lib/mobile-harness.mjs";

/**
 * A flow, and optionally **what its bytes must say** once it is green.
 *
 * `custody` is the catalog's out-of-band half (`plans/testing/crucial-flows.md` →
 * *Asserting on custody*): a function the harness runs against the app's own SQLite
 * directory after the flow passes on screen. It is deliberately attached here rather than
 * inside the harness — this is the file that says what each flow claims.
 */
const flow = (file, label, custody) => ({
  label,
  file: join(MAESTRO_DIR, "e2e", file),
  custody,
});

await runSuite({
  key: "test:e2e",
  title: "test:e2e — crucial-flow catalog (mobile)",
  what: "crucial-flow catalog",
  // Order is load-bearing: 01 leaves a fresh, accountless app; 02 fills it with Mary,
  // George, a milestone and a reminder; 04 converts that store and opens it by each door.
  flows: [
    flow(
      "01-first-run.yaml",
      "Flow 1 — first run reaches a usable state",
      custodyUnauthenticated,
    ),
    flow(
      "02-smoke.yaml",
      "Flow 2 — people, a milestone and a reminder survive a relaunch",
    ),
    flow(
      "04-create-account.yaml",
      "Flow 4 — an account turns encryption on, and both doors reopen it",
      custodyAuthenticated,
    ),
  ],
});
