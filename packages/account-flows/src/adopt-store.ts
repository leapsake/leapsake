import type { AccountFlowPorts } from "./ports.js";

/**
 * Move the open plaintext store into `accountId`'s encrypted slot: convert,
 * password door, roster entry, then remove the original.
 */
export async function adoptStore(
  ports: Pick<AccountFlowPorts, "roster" | "files">,
  opts: {
    accountId: string;
    username: string;
    dbKey: Uint8Array;
    passwordDoor: Uint8Array;
  },
): Promise<void> {
  const { roster, files } = ports;
  const { accountId, username, dbKey, passwordDoor } = opts;

  await files.close();

  // A killed attempt's leftover; a store the roster names is a live account.
  if (!(await roster.list()).some((a) => a.id === accountId)) {
    await files.removeAccountStore(accountId);
  }

  await files.convertToEncrypted(accountId, dbKey);
  // Before the roster entry, so an Authenticated device always has it.
  await files.writePasswordDoor(accountId, passwordDoor);
  await roster.add({
    id: accountId,
    username,
    createdAt: new Date().toISOString(),
  });

  // The account exists now, so a throw would hide the one-time phrase. The
  // boot path sweeps a plaintext store left beside an account's.
  try {
    await files.removePlaintextStore();
  } catch {
    // Swept on the next launch.
  }
}
