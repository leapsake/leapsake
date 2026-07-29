import { describe, expect, it } from "vitest";
import { fetchRelayCapabilities } from "./relay-capabilities.js";

/**
 * The relay-backup check (`model.md` §7.3.1). Every case here is really the same
 * assertion — **silence means "no copy"** — because that default is what makes
 * "Forget account" on a last device read as the deletion it is. The only path to
 * `true` is a relay that explicitly says so.
 */
const respond = (body: unknown, ok = true): typeof fetch =>
  (async () =>
    ({
      ok,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;

describe("fetchRelayCapabilities", () => {
  it("believes a relay that advertises a durable backup", async () => {
    const capabilities = await fetchRelayCapabilities({
      relayUrl: "https://relay.example",
      fetchImpl: respond({ durableBackup: true }),
    });
    expect(capabilities.durableBackup).toBe(true);
  });

  it("assumes no backup when there is no relay at all", async () => {
    // A local-only account: nothing to ask, and the answer that matters is the
    // alarming one — this device holds the only copy by definition.
    const capabilities = await fetchRelayCapabilities({
      fetchImpl: () => Promise.reject(new Error("should not be called")),
    });
    expect(capabilities.durableBackup).toBe(false);
  });

  it("assumes no backup when the relay does not serve the endpoint", async () => {
    // Today's universal case: no relay implements `/capabilities` yet.
    const capabilities = await fetchRelayCapabilities({
      relayUrl: "https://relay.example",
      fetchImpl: respond("Not Found", false),
    });
    expect(capabilities.durableBackup).toBe(false);
  });

  it("assumes no backup when the relay is unreachable", async () => {
    const capabilities = await fetchRelayCapabilities({
      relayUrl: "https://relay.example",
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    expect(capabilities.durableBackup).toBe(false);
  });

  it("assumes no backup on a body it cannot read", async () => {
    const capabilities = await fetchRelayCapabilities({
      relayUrl: "https://relay.example",
      fetchImpl: (() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new SyntaxError("not JSON")),
        } as unknown as Response)) as unknown as typeof fetch,
    });
    expect(capabilities.durableBackup).toBe(false);
  });

  it("requires a literal boolean, not merely something truthy", async () => {
    // A relay answering `"yes"` or `1` has not made the promise; reading it as
    // one would silence the warning on exactly the deletion it should shout about.
    for (const durableBackup of ["yes", 1, {}, null, undefined]) {
      const capabilities = await fetchRelayCapabilities({
        relayUrl: "https://relay.example",
        fetchImpl: respond({ durableBackup }),
      });
      expect(capabilities.durableBackup).toBe(false);
    }
  });
});
