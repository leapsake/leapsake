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

/** Reads the transport's `relay … failed: <status>` message, and the network
 *  errors Node's and React Native's `fetch` throw; anything else is not one. */
export function relayFailure(cause: unknown): RelayFailure | undefined {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (
    message.includes("fetch failed") ||
    message.includes("Network request failed")
  ) {
    return "unreachable";
  }
  const status = /^relay .+ failed: (\d{3})$/.exec(message)?.[1];
  if (status === undefined) return undefined;
  if (status === "409") return "username-taken";
  if (status === "401") return "unauthorized";
  if (status === "404") return "not-found";
  return "failed";
}

/** Runs a flow that calls the relay, rethrowing a relay failure as a
 *  {@link RelayError} and any other failure as it was. */
export async function overRelay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    const reason = relayFailure(cause);
    if (reason === undefined) throw cause;
    throw new RelayError(reason, { cause });
  }
}
