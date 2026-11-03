import { describe, expect, it } from "vitest";
import { RelayError } from "../src/index.js";
import { overRelay } from "../src/relay-error.js";

const failWith = (message: string) =>
  overRelay(() => Promise.reject(new TypeError(message))).catch(
    (e: unknown) => (e as RelayError).reason,
  );

describe("overRelay", () => {
  it("reads React Native's network failure as unreachable", async () => {
    expect(await failWith("Network request failed")).toBe("unreachable");
  });

  it("reads each relay status the transport reports", async () => {
    expect(await failWith("register failed: 409")).toBe("username-taken");
    expect(await failWith("session failed: 401")).toBe("unauthorized");
    expect(await failWith("lookup failed: 404")).toBe("not-found");
    expect(await failWith("pull failed: 500")).toBe("failed");
  });
});
