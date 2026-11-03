import { bindRelayToAccount } from "@leapsake/key-custody";
import { registerAccountWithRelay } from "@leapsake/sync";
import type { AccountFlowPorts } from "./ports.js";
import { RelayError, overRelay } from "./relay-error.js";

/**
 * Publish the account already on this device to a relay, minting nothing. A
 * taken username is a result, since it may be the user's own account.
 */
export async function startSyncing(
  ports: Pick<AccountFlowPorts, "keyStore" | "driver">,
  opts: { username: string; relayUrl: string },
): Promise<
  | { status: "bound"; accountId: string; username: string }
  | { status: "username-taken"; username: string }
> {
  const { keyStore, driver } = ports;
  const { username, relayUrl } = opts;
  try {
    const bound = await bindRelayToAccount({
      keyStore,
      driver,
      username,
      relayUrl,
      registerWithRelay: (bootstrap) =>
        overRelay(() => registerAccountWithRelay({ relayUrl, bootstrap })),
    });
    return { status: "bound", ...bound };
  } catch (cause) {
    if (cause instanceof RelayError && cause.reason === "username-taken") {
      return { status: "username-taken", username };
    }
    throw cause;
  }
}
