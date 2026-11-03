import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { createRelayServer } from "../src/relay.js";
import { createRelayStore } from "../src/store.js";

/** A real relay on an ephemeral local port, over an in-memory store, for
 *  tests that drive a client flow against it. */
export async function startRelay(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const server = createRelayServer({
    store: createRelayStore(new DatabaseSync(":memory:")),
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
