import {
  deriveKeyMaterial,
  encodeRecoveryPhrase,
  generateSalt,
  sealDbKeyForPassword,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import { describe, expect, it } from "vitest";
import {
  type StoreDoorSidecars,
  type UnlockAnswer,
  type UnlockRequest,
  unlockStore,
} from "../src/index.js";

const PASSWORD = "correct horse battery staple";
const randomKey = () => crypto.getRandomValues(new Uint8Array(32));

function sealedDoors() {
  const dbKey = randomKey();
  const recoveryKey = randomKey();
  const salt = generateSalt();
  const { kek } = deriveKeyMaterial(PASSWORD, salt);
  return {
    dbKey,
    recoveryKey,
    phrase: encodeRecoveryPhrase(recoveryKey),
    sidecars: {
      password: sealDbKeyForPassword({ dbKey, kek, salt }),
      phrase: sealDbKeyForRecovery(dbKey, recoveryKey),
    } satisfies StoreDoorSidecars,
  };
}

/** Answers in order and records every request; fails the test if it runs dry. */
function scriptedAnswers(...answers: UnlockAnswer[]) {
  const requests: UnlockRequest[] = [];
  const ask = (request: UnlockRequest) => {
    requests.push(request);
    const next = answers.shift();
    return next === undefined
      ? Promise.reject(new Error("asked more times than scripted"))
      : Promise.resolve(next);
  };
  return { ask, requests };
}

describe("unlockStore", () => {
  it("opens the db-key from the password and hands back its key material", async () => {
    const { dbKey, sidecars } = sealedDoors();
    const { ask } = scriptedAnswers({ door: "password", secret: PASSWORD });

    const unlocked = await unlockStore(sidecars, ask);

    expect(unlocked.dbKey).toEqual(dbKey);
    expect(unlocked.door.kind).toBe("password");
  });

  it("opens the db-key from the phrase and hands back the recovery key", async () => {
    const { dbKey, recoveryKey, phrase, sidecars } = sealedDoors();
    const { ask } = scriptedAnswers({ door: "phrase", secret: phrase });

    const unlocked = await unlockStore(sidecars, ask);

    expect(unlocked.dbKey).toEqual(dbKey);
    expect(unlocked.door).toEqual({ kind: "recovery", recoveryKey });
  });

  it("re-asks after a wrong password, saying why, then opens on the right one", async () => {
    const { dbKey, sidecars } = sealedDoors();
    const { ask, requests } = scriptedAnswers(
      { door: "password", secret: "not-the-password-at-all" },
      { door: "password", secret: PASSWORD },
    );

    const unlocked = await unlockStore(sidecars, ask);

    expect(unlocked.dbKey).toEqual(dbKey);
    expect(requests.map((r) => r.error)).toEqual([
      undefined,
      "That password doesn't open this database.",
    ]);
  });

  it("re-asks after a wrong phrase, and a phrase that isn't 24 words is just wrong", async () => {
    const { dbKey, phrase, sidecars } = sealedDoors();
    const { phrase: otherPhrase } = sealedDoors();
    const { ask, requests } = scriptedAnswers(
      { door: "phrase", secret: otherPhrase },
      { door: "phrase", secret: "george bailey" },
      { door: "phrase", secret: phrase },
    );

    const unlocked = await unlockStore(sidecars, ask);

    expect(unlocked.dbKey).toEqual(dbKey);
    expect(requests.map((r) => r.error)).toEqual([
      undefined,
      "That recovery phrase doesn't open this database.",
      "That recovery phrase doesn't open this database.",
    ]);
  });

  it("keeps the doors independent: a wrong password does not spoil the phrase", async () => {
    const { dbKey, phrase, sidecars } = sealedDoors();
    const { ask } = scriptedAnswers(
      { door: "password", secret: "wrong" },
      { door: "phrase", secret: phrase },
    );

    expect((await unlockStore(sidecars, ask)).dbKey).toEqual(dbKey);
  });

  it("offers only the doors the store has, and refuses one it does not", async () => {
    const { dbKey, phrase, sidecars } = sealedDoors();
    const { ask, requests } = scriptedAnswers(
      { door: "password", secret: PASSWORD },
      { door: "phrase", secret: phrase },
    );

    const unlocked = await unlockStore({ phrase: sidecars.phrase }, ask);

    expect(unlocked.dbKey).toEqual(dbKey);
    expect(requests).toEqual([
      { error: undefined, doors: { password: false, phrase: true } },
      {
        error: "That password doesn't open this database.",
        doors: { password: false, phrase: true },
      },
    ]);
  });
});
