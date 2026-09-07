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
// first run, Flow 2 fills it, Flow 3 writes onto what Flow 2 made. They share app state
// by design (the catalog takes 1→4 as one arc), so the harness stops the platform at the
// first red flow rather than reporting three failures that are really one.
//
// **The bar this meets is the `beta` rung, not the whole catalog** — Flows 1–5, on-screen
// assertions only (`CONTRIBUTING.md` → *The E2E release gate*, the rung table). 7b/7c and
// the out-of-band custody assertions are `rc`'s, and Flows 6/7a ship with sync.
import { join } from "node:path";

import { MAESTRO_DIR, runSuite } from "./lib/mobile-harness.mjs";

const flow = (file, label) => ({ label, file: join(MAESTRO_DIR, "e2e", file) });

await runSuite({
  key: "test:e2e",
  title: "test:e2e — crucial-flow catalog (mobile)",
  what: "crucial-flow catalog",
  // Order is load-bearing: 01 leaves a fresh, accountless app; 02 puts Ada and Augustus in
  // it; 03 writes a milestone onto Ada; 05 writes a reminder that mentions her. Inserting
  // a flow means deciding what state it inherits and what it leaves behind.
  //
  // **04 runs last, out of catalog order, because it is the one that ends the
  // Unauthenticated state.** Every flow before it is about the ordinary accountless app a
  // v0.1 user starts in, and 04's whole subject is the conversion away from it — so it
  // reads better as the arc's destination than as its middle, and nothing else has to run
  // under encryption to prove what it proves. The arc stays re-runnable either way:
  // `subflows/factory-reset.yaml` drives the reset under both of its names.
  flows: [
    flow("01-first-run.yaml", "Flow 1 — first run reaches a usable state"),
    flow("02-person-and-relationship.yaml", "Flow 2 — person + relationship"),
    flow("03-milestone.yaml", "Flow 3 — milestone survives a relaunch"),
    flow(
      "05-reminder-mention-tag.yaml",
      "Flow 5 — reminder @mention + #tag round trip",
    ),
    flow("04-create-account.yaml", "Flow 4 — an account turns encryption on"),
  ],
});
