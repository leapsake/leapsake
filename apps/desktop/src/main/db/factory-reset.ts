import { rmSync } from "node:fs";
import { join } from "node:path";
import { ROSTER_PATH } from "@leapsake/store-layout";

/**
 * Erase every on-device persistence surface so the next launch is a clean
 * first-run — the file half of the desktop **factory reset** (the caller closes
 * the DB handle first and re-opens the store after). Kept free of Electron so it
 * is unit-testable against a temp directory.
 *
 * Deletes, all under the app's `userData`:
 *  - the active store and its SQLite WAL/SHM sidecars,
 *  - both db-key sidecars — `<db>.recovery` (wrapped under the recovery phrase)
 *    and `<db>.password` (wrapped under the password-derived KEK). Leaving either
 *    would strand a door onto a key that no longer opens anything,
 *  - the whole `stores/` tree, so no other account's store is left orphaned,
 *  - the account **roster** (`model.md` §7.4), and
 *  - `keystore.json` (+ its atomic-write `.tmp`), which holds every keystore
 *    secret (`db-key`, `recovery-key`, `device-id`, `enclave`) — so removing it
 *    clears them all at once.
 *
 * **The roster is the load-bearing one.** It is what tells the next boot whether an
 * account exists, and therefore whether any key is minted at all (§7.2). Left
 * behind, it would send the next launch looking for the store of an account the
 * user had just erased, mint a fresh key over an empty encrypted database, and land
 * them back in a Protected state. Removing it is what makes the next boot the
 * genuinely keyless first run this is supposed to produce.
 *
 * `rmSync(..., { recursive: true, force: true })` treats an already-absent path as
 * success, so a partially-initialized install (e.g. no sidecar yet) resets cleanly.
 */
export function factoryResetFiles(opts: {
  dbPath: string;
  keystorePath: string;
  /** `userData` — the roster and the `stores/` tree hang off it. */
  userDataPath?: string;
}): void {
  const { dbPath, keystorePath, userDataPath } = opts;
  const targets = [
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
    `${dbPath}.recovery`,
    `${dbPath}.password`,
    keystorePath,
    `${keystorePath}.tmp`,
    ...(userDataPath === undefined
      ? []
      : [
          join(userDataPath, "stores"),
          join(userDataPath, ROSTER_PATH),
          join(userDataPath, `${ROSTER_PATH}.tmp`),
        ]),
  ];
  for (const path of targets) rmSync(path, { recursive: true, force: true });
}
