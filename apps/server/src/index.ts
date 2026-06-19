import { DatabaseSync } from "node:sqlite";
import { createRelayServer } from "./relay.js";
import { createRelayStore } from "./store.js";

/**
 * Runnable entry for the blind relay (plans/encryption/sync.md §2). Defaults are
 * dev-friendly; override with `PORT` and `RELAY_DB` (a file path, or `:memory:`).
 *
 * This slice ships the relay and its client adapter; the apps that *drive* it (a
 * sync trigger, wiring `register()` into enable-sync) are the next slice. There
 * is no TLS termination, rate limiting, or replay defense here yet — see
 * plans/encryption/security-review.md for the deferred hardening.
 */
const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.RELAY_DB ?? "relay.db";

const store = createRelayStore(new DatabaseSync(dbPath));
createRelayServer({ store }).listen(port, () => {
  console.log(`Leapsake relay listening on http://localhost:${port}`);
});
