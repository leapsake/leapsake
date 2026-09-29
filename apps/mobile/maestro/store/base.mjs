// Runs e2e flows 01 and 02 and stops, leaving a populated, accountless app for
// the store screenshots; see `README.md` → _Why not just run the e2e arc_.
import { join } from "node:path";

import {
  MAESTRO_DIR,
  runSuite,
} from "../../../../scripts/lib/mobile-harness.mjs";

const flow = (file, label) => ({ label, file: join(MAESTRO_DIR, "e2e", file) });

await runSuite({
  key: "stage:shots",
  title: "stage:shots — populate the app for store screenshots",
  what: "screenshot staging",
  flows: [
    flow("01-first-run.yaml", "Flow 1 — reset to a fresh first run"),
    flow("02-smoke.yaml", "Flow 2 — Mary, George, a milestone and a reminder"),
  ],
});
