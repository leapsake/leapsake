import { getSyncStatus } from "@leapsake/key-custody";
import { reauthenticateViaRelay } from "@leapsake/sync";
import type { AccountFlowPorts } from "./ports.js";
import { overRelay } from "./relay-error.js";

/** Take on a password changed on another device: the relay credential and
 *  this device's password door move to it; the master key does not change. */
export async function reauthenticate(
  ports: Pick<AccountFlowPorts, "keyStore" | "driver" | "files">,
  opts: { password: string },
): Promise<void> {
  const { keyStore, driver, files } = ports;
  const { accountId, relayUrl } = await getSyncStatus({ driver });
  if (accountId === undefined || relayUrl === undefined) {
    throw new Error("This device's account does not sync through a relay.");
  }
  await overRelay(() =>
    reauthenticateViaRelay({
      keyStore,
      driver,
      password: opts.password,
      writePasswordSidecar: (door) => files.writePasswordDoor(accountId, door),
    }),
  );
}
