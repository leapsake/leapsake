import type { TestApi } from "@leapsake/data/testing";

/**
 * A minimal, runner-agnostic `describe`/`it`/`expect` that *collects* results,
 * standing in for Vitest on device: the mobile native engine (expo-sqlite) can't
 * load in Node, so the shared {@link runDriverContract} suite runs in-app against
 * the real driver and reports PASS/FAIL on screen instead of to a test runner
 * (see `apps/mobile/README.md`).
 *
 * It is typed against {@link TestApi} (the exact slice the contract drives) so the
 * matcher surface here can't silently drift from what the spec needs — a missing or
 * mis-typed matcher is a compile error. `it` only *registers* cases; `run()`
 * executes them sequentially (the contract's bodies are async and each provisions
 * its own driver), collecting a pass/fail + message per case.
 */
export interface CaseResult {
  name: string;
  status: "pass" | "fail";
  error?: string;
}

/** Structural equality for the values the contract compares: primitives, plain
 *  objects, arrays, and byte buffers (a Node Buffer is a `Uint8Array` subclass, so
 *  both backends' BLOB results compare by bytes). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const ua = a as unknown as Uint8Array;
    const ub = b as unknown as Uint8Array;
    if (ua.length !== ub.length) return false;
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
    return true;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (
    typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null
  ) {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    );
  }

  return false;
}

function show(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function createCollectingTestApi(): {
  api: TestApi;
  run: () => Promise<CaseResult[]>;
} {
  const cases: { name: string; fn: () => void | Promise<void> }[] = [];

  const expect: TestApi["expect"] = (actual: unknown) => ({
    toBe(expected: unknown) {
      if (!Object.is(actual, expected)) {
        throw new Error(`expected ${show(actual)} to be ${show(expected)}`);
      }
    },
    toEqual(expected: unknown) {
      if (!deepEqual(actual, expected)) {
        throw new Error(`expected ${show(actual)} to equal ${show(expected)}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`expected ${show(actual)} to be undefined`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`expected ${show(actual)} to be null`);
      }
    },
    toBeInstanceOf(expected: unknown) {
      if (
        typeof expected !== "function" ||
        !(actual instanceof (expected as new (...args: never[]) => unknown))
      ) {
        const name =
          typeof expected === "function" ? expected.name : show(expected);
        throw new Error(
          `expected ${show(actual)} to be an instance of ${name}`,
        );
      }
    },
    rejects: {
      async toThrow(expected?: unknown) {
        try {
          await (actual as Promise<unknown>);
        } catch (caught) {
          if (expected !== undefined && !Object.is(caught, expected)) {
            throw new Error(
              `expected rejection ${show(caught)} to be ${show(expected)}`,
              { cause: caught },
            );
          }
          return;
        }
        throw new Error("expected promise to reject, but it resolved");
      },
    },
  });

  const api: TestApi = {
    // The contract registers everything synchronously inside one describe; just run
    // the body so its `it`s land in `cases`.
    describe: (_name, fn) => fn(),
    it: (name, fn) => cases.push({ name, fn }),
    expect,
  };

  const run = async (): Promise<CaseResult[]> => {
    const results: CaseResult[] = [];
    for (const c of cases) {
      try {
        await c.fn();
        results.push({ name: c.name, status: "pass" });
      } catch (error) {
        results.push({
          name: c.name,
          status: "fail",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  };

  return { api, run };
}
