// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSerializedWrites } from "../src/headless/index.js";

afterEach(cleanup);

/** Resolve/reject a promise from outside it, so a test can control ordering. */
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Host({
  operations,
  onSuccess,
}: {
  operations: (() => Promise<unknown>)[];
  onSuccess?: () => void;
}) {
  const { busy, error, run } = useSerializedWrites({ onSuccess });
  return (
    <>
      {operations.map((operation, index) => (
        <button key={index} type="button" onClick={() => run(operation)}>
          run {index}
        </button>
      ))}
      <output data-testid="busy">{busy ? "busy" : "idle"}</output>
      <output data-testid="error">{error ?? ""}</output>
    </>
  );
}

const click = (index: number) =>
  act(() => screen.getByText(`run ${index}`).click());
const busy = () => screen.getByTestId("busy").textContent;
const error = () => screen.getByTestId("error").textContent;
const flush = () => act(async () => {});

describe("useSerializedWrites", () => {
  it("runs writes in the order they were requested, never concurrently", async () => {
    const order: string[] = [];
    const first = deferred();
    render(
      <Host
        operations={[
          () => {
            order.push("start-1");
            return first.promise.then(() => void order.push("end-1"));
          },
          () => {
            order.push("start-2");
            return Promise.resolve();
          },
        ]}
      />,
    );

    click(0);
    click(1);
    await flush();
    // The second write must not have started while the first was in flight.
    expect(order).toEqual(["start-1"]);

    await act(async () => first.resolve());
    expect(order).toEqual(["start-1", "end-1", "start-2"]);
  });

  it("keeps the queue alive after a failure", async () => {
    // The failure this guards: without a rejection handler the chained promise
    // stays rejected, every later write chains off it, and the surface wedges
    // with nothing on screen to explain why.
    const ran = vi.fn(async () => {});
    render(
      <Host
        operations={[() => Promise.reject(new Error("nope")), () => ran()]}
      />,
    );

    click(0);
    await flush();
    expect(error()).toContain("nope");

    click(1);
    await flush();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("clears a previous error when the next write starts", async () => {
    const ran = vi.fn(async () => {});
    render(
      <Host
        operations={[() => Promise.reject(new Error("nope")), () => ran()]}
      />,
    );

    click(0);
    await flush();
    expect(error()).not.toBe("");

    click(1);
    await flush();
    expect(error()).toBe("");
  });

  it("reports busy while a write is in flight", async () => {
    const pending = deferred();
    render(<Host operations={[() => pending.promise]} />);

    expect(busy()).toBe("idle");
    click(0);
    expect(busy()).toBe("busy");

    await act(async () => pending.resolve());
    expect(busy()).toBe("idle");
  });

  it("reports success once per write that lands", async () => {
    const onSuccess = vi.fn();
    render(
      <Host
        operations={[async () => {}, async () => {}]}
        onSuccess={onSuccess}
      />,
    );

    click(0);
    await flush();
    click(1);
    await flush();
    expect(onSuccess).toHaveBeenCalledTimes(2);
  });

  it("does not report success for a write that failed", async () => {
    const onSuccess = vi.fn();
    render(
      <Host
        operations={[() => Promise.reject(new Error("nope"))]}
        onSuccess={onSuccess}
      />,
    );

    click(0);
    await flush();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
