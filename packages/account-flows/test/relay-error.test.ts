import { describe, expect, it } from "vitest";
import { RelayError } from "../src/index.js";
import { overRelay } from "../src/relay-error.js";

const failWith = (message: string) =>
  overRelay(() => Promise.reject(new Error(message))).catch(
    (e: unknown) => (e as RelayError).reason,
  );

describe("overRelay", () => {
  it("reads React Native's network failure as unreachable", async () => {
    expect(await failWith("Network request failed")).toBe("unreachable");
  });

  it("reads each relay status the transport reports", async () => {
    expect(await failWith("relay register failed: 409")).toBe("username-taken");
    expect(await failWith("relay POST /accounts/session failed: 401")).toBe(
      "unauthorized",
    );
    expect(await failWith("relay lookup failed: 404")).toBe("not-found");
    expect(await failWith("relay pull failed: 500")).toBe("failed");
  });

  it("passes a failure that is not the relay's through unchanged", async () => {
    const local = new Error("This device is already part of an account.");

    await expect(overRelay(() => Promise.reject(local))).rejects.toBe(local);
  });
});
