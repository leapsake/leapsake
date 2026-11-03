/** Why a relay call failed, for a client to word; `failed` is anything the
 *  relay said that no other reason names. */
export type RelayFailure =
  | "unreachable"
  | "username-taken"
  | "unauthorized"
  | "not-found"
  | "failed";

/** A relay call that failed, with the reason a client words it by. */
export class RelayError extends Error {
  readonly reason: RelayFailure;

  constructor(reason: RelayFailure, options: { cause: unknown }) {
    super(`relay request failed (${reason})`, options);
    this.name = "RelayError";
    this.reason = reason;
  }
}

/** Reads the transport's `failed: <status>` message, and the network errors
 *  Node's and React Native's `fetch` throw. */
export function relayFailure(cause: unknown): RelayFailure {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (
    message.includes("fetch failed") ||
    message.includes("Network request failed")
  ) {
    return "unreachable";
  }
  if (message.includes("409")) return "username-taken";
  if (message.includes("401")) return "unauthorized";
  if (message.includes("404")) return "not-found";
  return "failed";
}

/** Runs a relay call, rethrowing its failure as a {@link RelayError}. */
export async function overRelay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    throw new RelayError(relayFailure(cause), { cause });
  }
}
