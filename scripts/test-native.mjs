// The mobile native test tier (testing backlog steps 3b + 9): drive the in-app
// driver-contract self-test on a booted device — Android emulator and/or iOS simulator —
// from the command line and assert PASS, so the mobile driver leg is a *terminal,
// automated* gate rather than a human opening `leapsake://dev-selftest` and reading the
// screen (principle #1: automate over manual). See CONTRIBUTING.md → Testing for the
// principles and `apps/mobile/README.md` → *Why the driver test needs a device* for why
// this must run on a real device (expo-sqlite's native engine can't load headlessly).
//
// This is what `pnpm test:native` runs (NOT the orchestrator — that would loop:
// test-all --only=native -> pnpm test:native -> test-all …). `scripts/test-all.mjs`
// runs each platform via `pnpm test:native --platform=<x>` and maps our exit code.
//
// Everything about *getting there* — device detection, provisioning, the dev-client
// install, Metro, the per-platform bundle-load prepare — is `scripts/lib/mobile-harness.mjs`,
// shared with `scripts/test-e2e.mjs`. All this file contributes is which flow to run.
import { join } from "node:path";

import { MAESTRO_DIR, runSuite } from "./lib/mobile-harness.mjs";

await runSuite({
  key: "test:native",
  title: "test:native — mobile driver-contract",
  what: "driver-contract self-test",
  // One flow, and its PASS/FAIL/ERROR token is the whole verdict. The flow deep-links to
  // `leapsake://dev-selftest`, waits for the async contract run, and asserts the
  // `driver-selftest-status` element's label — see apps/mobile/maestro/README.md.
  flows: [
    {
      label: "driver-contract self-test",
      file: join(MAESTRO_DIR, "driver-selftest.yaml"),
    },
  ],
});
