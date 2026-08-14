import type { CoreApi } from "@leapsake/core";
import type {
  Ready,
  Request,
  Response,
  ResumeSummary,
  Stage,
  Summary,
} from "./worker-protocol.js";

/**
 * The main thread's half of Increment 5c: a `CoreApi` that is not a `core`.
 *
 * Every property access builds a path, every call posts it to the worker, and
 * the reply resolves the promise. Forty lines of `Proxy`, and it is the whole
 * reason the screen could stay one shared file — `person-app.tsx` calls
 * `core.views.person(id)` without knowing that `core` is a message.
 *
 * That this works at all is a property of `CoreApi` rather than a trick here:
 * it is entirely async and entirely plain-data, because it was already designed
 * to cross desktop's `ipcRenderer` boundary. **This re-hosts `core` behind a
 * different RPC; it re-implements nothing.**
 *
 * ## What it deliberately does not do
 *
 * No batching, no caching, no request coalescing. The person loader fires seven
 * calls in one `Promise.all` and they cross as seven messages — measured, and
 * the answer is in the findings. Adding a batch API would have made the number
 * unmeasurable and hidden whether one was needed.
 */

/** The three things a page gets from the worker. */
export interface WorkerClient {
  /** Username + password → the whole login, on the worker's thread. */
  login: (username: string, password: string) => Promise<Summary>;
  /**
   * **Increment 5e**: the same client, from the wrap in IndexedDB. No password,
   * and the worker enforces no network for the duration.
   */
  resume: () => Promise<ResumeSummary>;
  /** Drop the wrap, keeping the store — the logout half of custody. */
  forget: () => Promise<string>;
  /** `CoreApi` over `postMessage`. Usable after a {@link WorkerClient.login} or {@link WorkerClient.resume}. */
  core: CoreApi;
  /** Throw the OPFS database **and the wrap** away; resolves to the files that remain. */
  wipe: () => Promise<string[]>;
  /** Resolves when sqlite-wasm and the OPFS pool are up — or rejects if not. */
  ready: Promise<Extract<Ready, { error?: undefined }>>;
}

export function createWorkerClient(
  worker: Worker,
  onStage: (stage: Stage) => void,
): WorkerClient {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  let onReady: (value: Extract<Ready, { error?: undefined }>) => void;
  let onReadyFailed: (error: Error) => void;
  const ready = new Promise<Extract<Ready, { error?: undefined }>>(
    (resolve, reject) => {
      onReady = resolve;
      onReadyFailed = reject;
    },
  );

  worker.addEventListener("message", (event: MessageEvent<Ready | Stage | Response>) => {
    const message = event.data;
    if (message.kind === "stage") {
      onStage(message);
      return;
    }
    if (message.kind === "ready") {
      if (message.error === undefined) onReady(message);
      else onReadyFailed(new Error(message.error));
      return;
    }
    const waiting = pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id);
    if (message.ok) waiting.resolve(message.value);
    // The worker's own error text, re-thrown here so a failure reads as a
    // failure of the call the page made rather than as a dead worker.
    else waiting.reject(new Error(message.error));
  });

  function send(request: Omit<Request, "id">): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id } as Request);
    });
  }

  /**
   * A proxy that accumulates the property path it was walked down, and posts it
   * when finally called.
   *
   * The `then` guard is load-bearing rather than defensive: `await core.views`
   * — or any accidental `await` of a namespace — would otherwise see a truthy
   * `then` on the proxy, take it for a thenable, and hang forever calling
   * `core.views.then(resolve, reject)` on the worker. Returning `undefined` for
   * it makes the proxy honestly not-a-promise.
   */
  function pathProxy(path: readonly string[]): unknown {
    return new Proxy(function noop() {} as unknown as object, {
      get(_target, property) {
        if (typeof property !== "string" || property === "then") return undefined;
        return pathProxy([...path, property]);
      },
      apply(_target, _thisArg, args: unknown[]) {
        return send({ kind: "call", path, args });
      },
    });
  }

  return {
    ready,
    login: (username, password) =>
      send({ kind: "login", username, password }) as Promise<Summary>,
    resume: () => send({ kind: "resume" }) as Promise<ResumeSummary>,
    forget: () => send({ kind: "forget" }) as Promise<string>,
    wipe: () => send({ kind: "wipe" }) as Promise<string[]>,
    core: pathProxy([]) as CoreApi,
  };
}
