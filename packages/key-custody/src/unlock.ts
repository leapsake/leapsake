import {
  decodeRecoveryPhrase,
  openDbKeyFromRecovery,
  openPasswordSidecar,
} from "@leapsake/crypto";
import type { AdoptionDoor } from "./session.js";

const WRONG_PASSWORD = "That password doesn't open this database.";
const WRONG_PHRASE = "That recovery phrase doesn't open this database.";

/** The sealed db-key copies a store holds beside it: one per door. */
export interface StoreDoorSidecars {
  password?: Uint8Array;
  phrase?: Uint8Array;
}

/** The doors this store has, and why the last try failed. */
export interface UnlockRequest {
  error?: string;
  doors: { password: boolean; phrase: boolean };
}

/** The secret the user typed, and which door they typed it into. */
export interface UnlockAnswer {
  door: "password" | "phrase";
  secret: string;
}

/**
 * Ask for a secret until one opens the db-key, re-asking with the failure each
 * time. Resolves with the key and the door that opened it; never gives up.
 */
export async function unlockStore(
  sidecars: StoreDoorSidecars,
  ask: (request: UnlockRequest) => Promise<UnlockAnswer>,
): Promise<{ dbKey: Uint8Array; door: AdoptionDoor }> {
  const doors = {
    password: sidecars.password !== undefined,
    phrase: sidecars.phrase !== undefined,
  };
  let error: string | undefined;
  for (;;) {
    const answer = await ask({ error, doors });
    const opened = tryDoor(sidecars, answer);
    if (opened !== undefined) return opened;
    error = answer.door === "password" ? WRONG_PASSWORD : WRONG_PHRASE;
  }
}

function tryDoor(
  sidecars: StoreDoorSidecars,
  answer: UnlockAnswer,
): { dbKey: Uint8Array; door: AdoptionDoor } | undefined {
  try {
    if (answer.door === "password" && sidecars.password !== undefined) {
      const { dbKey, kek, authVerifier } = openPasswordSidecar(
        sidecars.password,
        answer.secret,
      );
      return { dbKey, door: { kind: "password", kek, authVerifier } };
    }
    if (answer.door === "phrase" && sidecars.phrase !== undefined) {
      const recoveryKey = decodeRecoveryPhrase(answer.secret);
      return {
        dbKey: openDbKeyFromRecovery(sidecars.phrase, recoveryKey),
        door: { kind: "recovery", recoveryKey },
      };
    }
  } catch {
    // A wrong secret and a malformed sidecar read the same to the user.
  }
  return undefined;
}
