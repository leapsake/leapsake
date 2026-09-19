import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RosterStorage } from "@leapsake/store-layout";

/**
 * The roster as plain JSON, readable before any store opens. Written atomically
 * (temp file + rename), since it decides whether this launch mints keys.
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
