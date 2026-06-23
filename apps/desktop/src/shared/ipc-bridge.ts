import type { CoreApi } from "@leapsake/core";

/**
 * The generic Electron-IPC bridge that desktop uses to expose the entire
 * {@link CoreApi} to the renderer without hand-transcribing every method three
 * times (the core impl, the `ipcMain.handle` registrations, the
 * `ipcRenderer.invoke` wrappers). The shape is provably 1:1 — the renderer
 * consumes `window.api` typed as `CoreApi` — so the only real work is forwarding
 * args across the process boundary, which these two walkers do from one channel
 * manifest (`api-channels.ts`).
 *
 * This is deliberately desktop-only and Electron-agnostic: it imports `electron`
 * nowhere; the caller injects `invoke`/`handle`. Mobile calls `core` in-process
 * and bridges nothing.
 */

/**
 * The dotted paths of every *method* (function leaf) on `T`, e.g.
 * `"people.create"`, `"contactMethods.emails.update"`. Nested objects recurse;
 * non-function leaves drop out. This is the type the channel manifest is checked
 * against, so a method with no channel — or a channel naming no method — is a
 * compile error, preserving the no-drift guarantee `satisfies CoreApi` gave.
 */
export type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends (...args: never[]) => unknown
    ? `${Prefix}${K}`
    : T[K] extends object
      ? Leaves<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

/** Every IPC channel string: one per `CoreApi` method, as a dotted path. */
export type ApiChannel = Leaves<CoreApi>;

/**
 * Transform the loosely-typed args that arrive over IPC into the args the core
 * method receives — the renderer trust boundary. Only the ~handful of write
 * channels that Zod-parse / coerce need one; every other channel forwards as-is.
 */
export type ArgParser = (args: readonly unknown[]) => unknown[];

/** Walk a dotted `channel` to its bound method on `root`. */
export function resolveMethod(
  root: unknown,
  channel: string,
): (...args: unknown[]) => unknown {
  let parent: Record<string, unknown> | undefined;
  let target: unknown = root;
  for (const segment of channel.split(".")) {
    parent = target as Record<string, unknown>;
    target = parent[segment];
  }
  if (typeof target !== "function") {
    throw new Error(`IPC channel "${channel}" does not resolve to a method`);
  }
  return (target as (...args: unknown[]) => unknown).bind(parent);
}

/**
 * Build the renderer-side `window.api` object: a `CoreApi`-shaped tree of
 * functions, each forwarding to `invoke(channel, args)`. The returned object is
 * the runtime implementation of `CoreApi`; the renderer's static types come from
 * `CoreApi` itself, and the channel list's completeness is guaranteed by the
 * `ApiChannel` exhaustiveness check in `api-channels.ts`.
 */
export function buildBridgeApi(
  channels: readonly string[],
  invoke: (channel: string, args: unknown[]) => unknown,
): CoreApi {
  const root: Record<string, unknown> = {};
  for (const channel of channels) {
    const segments = channel.split(".");
    const leaf = segments.pop() as string;
    let node = root;
    for (const segment of segments) {
      node[segment] ??= {};
      node = node[segment] as Record<string, unknown>;
    }
    node[leaf] = (...args: unknown[]): unknown => invoke(channel, args);
  }
  return root as unknown as CoreApi;
}

/**
 * Register one `ipcMain` handler per channel, each forwarding to the *current*
 * core (read through `getCore` so `sync:join` can swap the underlying session
 * without re-registering). A channel listed in `parsers` runs its boundary parse
 * first; the rest forward their args unchanged. `core` already owns atomicity, so
 * a handler must never open its own transaction.
 */
export function registerCoreHandlers(opts: {
  channels: readonly string[];
  getCore: () => CoreApi;
  handle: (channel: string, handler: (args: unknown[]) => unknown) => void;
  parsers?: Partial<Record<string, ArgParser>>;
}): void {
  const { channels, getCore, handle, parsers = {} } = opts;
  for (const channel of channels) {
    const parse = parsers[channel];
    handle(channel, (args) =>
      resolveMethod(getCore(), channel)(...(parse ? parse(args) : args)),
    );
  }
}
