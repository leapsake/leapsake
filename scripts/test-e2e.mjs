// The crucial-flow catalog on a booted device: an ordered arc of flows that
// share state. See `apps/mobile/maestro/README.md` → _`e2e/`_.
import { join } from "node:path";

import {
  custodyAuthenticated,
  custodyUnauthenticated,
} from "./lib/custody-assertions.mjs";
import { MAESTRO_DIR, runSuite } from "./lib/mobile-harness.mjs";

/** A flow, and the `custody` check its bytes must pass once it is green. */
const flow = (file, label, custody) => ({
  label,
  file: join(MAESTRO_DIR, "e2e", file),
  custody,
});

await runSuite({
  key: "test:e2e",
  title: "test:e2e — crucial-flow catalog (mobile)",
  what: "crucial-flow catalog",
  // In order: 01 a fresh app, 02 fills it, 04 converts it and opens each door.
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
