import { afterEach, describe, expect, it, vi } from "vitest";
import { createSyncScheduler } from "../src/sync-scheduler.js";

/**
 * The scheduling primitive behind seamless background sync. It owns only the
 * timing concerns — single-flight, debounce, interval, error containment — over
 * an injected `run` thunk, so these tests drive it with a fake `run` and fake
 * timers; the real `runAccountSync` + the "is it enabled" guard live in the
 * client-supplied thunk and are covered elsewhere.
 */
describe("createSyncScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is single-flight: overlapping triggers share one run", async () => {
    let resolveRun!: (value: { at: number } | undefined) => void;
    const run = vi.fn(
      () =>
        new Promise<{ at: number } | undefined>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const scheduler = createSyncScheduler({ run });

    const first = scheduler.trigger();
    const second = scheduler.trigger();
    expect(run).toHaveBeenCalledTimes(1);

    resolveRun({ at: 7 });
    expect(await first).toEqual({ at: 7 });
    expect(await second).toEqual({ at: 7 });

    // Once settled, a new trigger runs again rather than reusing the old result.
    void scheduler.trigger();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("debounces kicks into a single run", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ at: 1 }));
    const scheduler = createSyncScheduler({ run, debounceMs: 2_000 });

    scheduler.kick();
    scheduler.kick();
    scheduler.kick();
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs on the interval and stops on stop()", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ at: 1 }));
    const scheduler = createSyncScheduler({ run, intervalMs: 1_000 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending kick on stop()", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ at: 1 }));
    const scheduler = createSyncScheduler({ run, debounceMs: 2_000 });

    scheduler.kick();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("treats an undefined run result as a quiet skip", async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    const run = vi.fn(async () => undefined);
    const scheduler = createSyncScheduler({ run, onResult, onError });

    expect(await scheduler.trigger()).toBeUndefined();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("routes a successful run to onResult", async () => {
    const onResult = vi.fn();
    const run = vi.fn(async () => ({ at: 42 }));
    const scheduler = createSyncScheduler({ run, onResult });

    await scheduler.trigger();
    expect(onResult).toHaveBeenCalledWith({ at: 42 });
  });

  it("routes a failure to onError without rejecting the interval", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const failure = new Error("relay down");
    const run = vi.fn(async () => {
      throw failure;
    });
    const scheduler = createSyncScheduler({
      run,
      onError,
      intervalMs: 1_000,
    });

    scheduler.start();
    // If the interval callback let the rejection escape, this would throw.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledWith(failure);
    scheduler.stop();

    // A manual caller, by contrast, still sees the rejection.
    await expect(scheduler.trigger()).rejects.toThrow("relay down");
  });

  it("start() is idempotent", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ at: 1 }));
    const scheduler = createSyncScheduler({ run, intervalMs: 1_000 });

    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gates automatic sync but never the manual trigger when autoEnabled is false", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ at: 1 }));
    const scheduler = createSyncScheduler({
      run,
      autoEnabled: false,
      intervalMs: 1_000,
      debounceMs: 2_000,
    });

    // The automatic paths are inert: kick (writes), interval, and autoTrigger.
    scheduler.start();
    scheduler.kick();
    expect(await scheduler.autoTrigger()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).not.toHaveBeenCalled();

    // The manual "Sync now" path still runs regardless of the preference.
    expect(await scheduler.trigger()).toEqual({ at: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("setAutoEnabled(true) fires a catch-up sync and resumes automatic triggers", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ at: 1 }));
    const scheduler = createSyncScheduler({
      run,
      autoEnabled: false,
      debounceMs: 2_000,
    });

    // Re-enabling syncs immediately rather than waiting for the next event.
    scheduler.setAutoEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    // ...and automatic triggers (here a write kick) work again afterward.
    scheduler.kick();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("setAutoEnabled(false) cancels a pending write kick", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ at: 1 }));
    const scheduler = createSyncScheduler({ run, debounceMs: 2_000 });

    scheduler.kick();
    scheduler.setAutoEnabled(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).not.toHaveBeenCalled();
  });
});
