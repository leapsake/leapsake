import { rmSync } from "node:fs";
import { join } from "node:path";
import { ROSTER_PATH } from "@leapsake/store-layout";

/**
 * Erase the store, both doors, every other store, the roster and the keystore,
 * so the next launch is a keyless first run. Absent paths are fine.
 */
export function factoryResetFiles(opts: {
  dbPath: string;
  keystorePath: string;
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
