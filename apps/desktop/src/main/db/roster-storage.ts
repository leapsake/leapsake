import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RosterStorage } from "@leapsake/store-layout";

/**
 * The desktop {@link RosterStorage}: the account roster as a plain JSON file under
 * `userData` (`model.md` §7.4). Unencrypted by necessity — it must be readable
 * before any store is opened, and you cannot enumerate accounts from inside files
 * you cannot decrypt.
 *
 * Written atomically (temp file + rename) for the same reason the keystore is: a
 * half-written roster read on the next boot would misreport which accounts exist,
 * and the roster is what decides whether this launch mints keys at all. A rename
 * within one directory is atomic on both APFS and NTFS, so a reader sees either
 * the old file or the new one.
 */
export function jsonFileStorage(filePath: string): RosterStorage {
  return {
    async read() {
      try {
        return readFileSync(filePath, "utf8");
      } catch (error) {
        // A missing roster is the normal first-launch state, not a failure.
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
    },

    async write(text) {
      mkdirSync(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp`;
      writeFileSync(tempPath, text, "utf8");
      renameSync(tempPath, filePath);
    },
  };
}
