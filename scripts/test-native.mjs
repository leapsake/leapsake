// The driver-contract self-test on a booted device, asserting PASS; the
// harness in `lib/mobile-harness.mjs` does the rest.
import { join } from "node:path";

import { MAESTRO_DIR, runSuite } from "./lib/mobile-harness.mjs";

await runSuite({
  key: "test:native",
  title: "test:native — mobile driver-contract",
  what: "driver-contract self-test",
  // One flow, whose PASS, FAIL or ERROR token is the whole verdict.
  flows: [
    {
      label: "driver-contract self-test",
      file: join(MAESTRO_DIR, "driver-selftest.yaml"),
    },
  ],
});
