import type { EncryptedRecord, SyncTransport } from "@leapsake/sync";

/**
 * Every measurement the spike takes, in **one file** so it is one file to read
 * and one to delete (`plans/v0-1_web-spike.md` → *What to measure*).
 *
 * Nothing here is production code and nothing here should grow a dependency in
 * the other direction: the routes and scripts call in, this calls nothing back.
 */

/** Milliseconds, to one decimal — `performance.now()` deltas are sub-ms noisy. */
function ms(from: number): number {
  return Math.round((performance.now() - from) * 10) / 10;
}

/** Run `fn`, returning its value alongside how long it took. */
export async function timed<T>(fn: () => Promise<T>): Promise<{
  value: T;
  ms: number;
}> {
  const started = performance.now();
  const value = await fn();
  return { value, ms: ms(started) };
}

/**
 * What a wrapped transport saw. `bytes` is the serialized ciphertext envelope
 * size — a faithful stand-in for wire bytes without reaching into `fetch`,
 * because the relay's body *is* the base64 of these records.
 */
export interface TransportStats {
  /** Wall time inside `push`/`pull` — i.e. network + relay, not crypto. */
  transportMs: number;
  /** Records crossing the wire, either direction. */
  records: number;
  /** Ciphertext bytes crossing the wire. */
  bytes: number;
}

/**
 * Wrap a {@link SyncTransport} to record per-call time, record counts, and wire
 * bytes.
 *
 * This exists because `SyncEngine.pull` exposes **no sub-timings** — it returns
 * only `{ cursor, applied }`. Wrapping the transport is the seam that splits the
 * total: **decrypt + apply = total − transportMs**. That split is the whole
 * point of the measurement, because it is what says whether a browser doing the
 * same work client-side is viable, and the relay is a constant across both.
 */
export function instrumentTransport(inner: SyncTransport): SyncTransport & {
  stats: () => TransportStats;
} {
  let transportMs = 0;
  let records = 0;
  let bytes = 0;

  const count = (batch: EncryptedRecord[]): void => {
    records += batch.length;
    for (const record of batch) bytes += record.ciphertext.byteLength;
  };

  return {
    async push(batch) {
      const started = performance.now();
      await inner.push(batch);
      transportMs += ms(started);
      count(batch);
    },
    async pull(since) {
      const started = performance.now();
      const result = await inner.pull(since);
      transportMs += ms(started);
      count(result.records);
      return result;
    },
    stats: () => ({
      transportMs: Math.round(transportMs * 10) / 10,
      records,
      bytes,
    }),
  };
}

/**
 * Sample event-loop lag while something expensive runs.
 *
 * The reason this is here rather than a `Date.now()` around Argon2id: "Argon2
 * costs 900 ms" is interesting, but "Argon2 **stalls every other in-flight
 * request** by 900 ms" is decisive, because it means a real SSR host needs a
 * worker pool or a native binding — and neither exists in this repo. A 50 ms
 * timer that fires 900 ms late measures exactly that.
 */
export function eventLoopLag(): { stop: () => Promise<number> } {
  const interval = 50;
  let max = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last - interval);
    last = now;
  }, interval);
  timer.unref?.();

  return {
    // `stop` is **async on purpose, and the async is the whole probe**. The work
    // being measured (`deriveKeyMaterial`) is synchronous, so no timer callback
    // can run while it blocks — the overdue callback is merely queued. Clearing
    // the interval in the same tick reads `max === 0` and reports a stall of zero
    // for a call that froze the process for a third of a second: a false negative
    // on the number that decides whether an SSR host needs a worker pool.
    //
    // Two fixes, both needed. `setTimeout(0)` rather than `setImmediate`, because
    // immediates run in the **check** phase and can beat an overdue interval in
    // the **timers** phase; a timeout queues behind it instead. And a final
    // direct reading, because if the block spanned the whole probe no callback
    // ever ran and `last` is still the start — so the elapsed-minus-interval
    // reading is the only evidence there is. Resolution is ±`interval` either way.
    stop: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      clearInterval(timer);
      max = Math.max(max, performance.now() - last - interval);
      return Math.round(Math.max(0, max) * 10) / 10;
    },
  };
}

/** One row of the findings' measurement table, formatted for a terminal. */
export function reportRow(
  label: string,
  opts: { rows: number; totalMs: number; stats: TransportStats },
): string {
  const { rows, totalMs, stats } = opts;
  // Everything that was not the wire: seal+collect on a push, decrypt+apply on a
  // pull. One neutral label rather than "decrypt+apply" on both, because calling
  // the push side a decrypt would be simply wrong.
  const localMs = Math.round((totalMs - stats.transportMs) * 10) / 10;
  const perRow = rows === 0 ? 0 : Math.round((totalMs / rows) * 100) / 100;
  return [
    label.padEnd(14),
    `${stats.records} records`.padEnd(16),
    `${(stats.bytes / 1024).toFixed(1)} KiB wire`.padEnd(18),
    `${stats.transportMs} ms transport`.padEnd(22),
    `${localMs} ms crypto+db`.padEnd(22),
    `${perRow} ms/row`,
  ].join("");
}
