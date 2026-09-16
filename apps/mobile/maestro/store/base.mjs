// Stage the app for store-listing screenshots — NOT a test tier.
//
// Runs the front half of the e2e arc and stops, leaving a populated, accountless app on
// the device for `01-roster.yaml` to build on. `04-capture.yaml` takes the pictures.
//
// Why this exists rather than `pnpm test:e2e`:
//
//   - **04 is skipped.** Its account conversion is a 19MiB memory-hard Argon2id pass on
//     unJITted Hermes — minutes of wall-clock buying nothing a screenshot shows.
//   - ⚠️ **07b MUST NOT run.** It opens by resetting the device, which destroys exactly
//     the store these screenshots are of. Same for 07c, which needs 04's end state.
//   - **No `--provision`.** Under it the harness shuts the device down and stops Metro the
//     moment flows finish, taking the staged state with it. Without it the device is
//     "the developer's own" and is left alone — which is the whole point here.
//
// Order is inherited from `scripts/test-e2e.mjs` and is load-bearing: 01 resets to a
// fresh accountless app, 02 puts Mary and George Bailey in it, 03 hangs a milestone on
// Mary, 05 writes a reminder that @mentions her — which is what gives Home something to
// show. Home is the lead screenshot, so 05 is not optional here.
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
    flow(
      "02-person-and-relationship.yaml",
      "Flow 2 — Mary + George + a relationship",
    ),
    flow("03-milestone.yaml", "Flow 3 — a milestone on Mary"),
    flow(
      "05-reminder-mention-tag.yaml",
      "Flow 5 — a reminder that mentions Mary",
    ),
  ],
});
