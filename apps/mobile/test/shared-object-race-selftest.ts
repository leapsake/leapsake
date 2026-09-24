import * as SQLite from "expo-sqlite";
import type { TestApi } from "@leapsake/data/testing";

// Statements stay referenced so the live shared-object count only climbs: every wave
// forces the native registry through a larger rehash while earlier calls resolve ids.
const WAVES = [1024, 2048, 4096, 8192, 16384, 32768];

function describeRejection(reason: unknown): string {
  const code = (reason as { code?: unknown } | null)?.code;
  const message = reason instanceof Error ? reason.message : String(reason);
  return `${String(code ?? "no code")}: ${message.split("\n")[0]}`;
}

export function runSharedObjectRaceSelfTest(t: TestApi): void {
  const { describe, it, expect } = t;

  describe("expo shared objects under concurrent statements", () => {
    it("resolves every statement while the registry grows", async () => {
      const db = await SQLite.openDatabaseAsync(":memory:", {
        useNewConnection: true,
      });
      const retained: SQLite.SQLiteStatement[] = [];
      const failures = new Set<string>();
      try {
        for (const size of WAVES) {
          const settled = await Promise.allSettled(
            Array.from({ length: size }, async () => {
              const statement = await db.prepareAsync("SELECT 1 AS v");
              retained.push(statement);
              await statement.finalizeAsync();
            }),
          );
          for (const result of settled) {
            if (result.status === "rejected") {
              failures.add(describeRejection(result.reason));
            }
          }
        }
      } finally {
        await db.closeAsync();
      }
      expect([...failures]).toEqual([]);
    });
  });
}
