import { rmSync } from "node:fs";

/**
 * Erase every on-device persistence surface so the next launch is a clean
 * first-run — the file half of the desktop **factory reset** (the caller closes
 * the DB handle first and relaunches after). Kept free of Electron so it is
 * unit-testable against a temp directory.
 *
 * Deletes, all under the app's `userData`:
 *  - the encrypted `leapsake.db` and its SQLite WAL/SHM sidecars,
 *  - the `<db>.recovery` file that wraps the db-key under the recovery phrase, and
 *  - `keystore.json` (+ its atomic-write `.tmp`), which holds every keystore
 *    secret (`db-key`, `recovery-key`, `device-id`, `enclave`) — so removing it
 *    clears them all at once.
 *
 * With all three gone, `openAppDatabase` on the next boot takes the fresh-install
 * path: mint a new db-key, migrate an empty DB, and land with no account or data.
 * `rmSync(..., { force: true })` treats an already-absent file as success, so a
 * partially-initialized install (e.g. no sidecar yet) resets cleanly too.
 */
export function factoryResetFiles(opts: {
  dbPath: string;
  keystorePath: string;
}): void {
  const { dbPath, keystorePath } = opts;
  const targets = [
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
    `${dbPath}.recovery`,
    keystorePath,
    `${keystorePath}.tmp`,
  ];
  for (const path of targets) rmSync(path, { force: true });
}
