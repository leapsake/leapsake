import type { CoreApi } from "@leapsake/core";

/**
 * Expose {@link CoreApi} over IPC from one channel manifest. Electron-free: the
 * caller injects `invoke` and `handle`. Mobile calls core in-process instead.
 */

/**
 * The dotted path of every method on `T`, e.g. `"people.create"`; non-function
 * leaves drop out.
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

/** Parse or coerce a channel's raw IPC args before core receives them. */
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

/** Build `window.api`: a `CoreApi`-shaped tree, each leaf calling `invoke`. */
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
 * One handler per channel, each forwarding to the current `getCore()` after its
 * parser, if any. Core owns atomicity, so a handler never opens a transaction.
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
