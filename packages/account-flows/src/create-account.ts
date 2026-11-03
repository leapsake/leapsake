import { MIN_PASSWORD_LENGTH, createLocalAccount } from "@leapsake/key-custody";
import { adoptStore } from "./adopt-store.js";
import type { AccountFlowPorts } from "./ports.js";

/** Create an account on this device, the act that turns encryption on, and
 *  return the recovery phrase to show once. */
export async function createAccount(
  ports: AccountFlowPorts,
  opts: { username: string; password: string },
): Promise<{ accountId: string; recoveryPhrase: string }> {
  const { keyStore, driver, custody, platform } = ports;
  const { username, password } = opts;

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  if (custody !== "plaintext") {
    throw new Error(
      "This device already holds an account. Forget it before creating another.",
    );
  }

  const { accountId, recoveryPhrase, dbKey, passwordSidecar } =
    await createLocalAccount({
      keyStore,
      driver,
      username,
      password,
      platform,
    });
  await adoptStore(ports, {
    accountId,
    username,
    dbKey,
    passwordDoor: passwordSidecar,
  });
  return { accountId, recoveryPhrase };
}
