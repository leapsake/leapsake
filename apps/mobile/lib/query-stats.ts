import type { SqliteDriver } from "@leapsake/core";

/** One measured span's result, as {@link QueryStats.measure} reports it. */
export interface QuerySpan {
  label: string;
  /** Statements issued by anything, not only this span, while it ran. */
  statements: number;
  ms: number;
  /** The other measured spans running at any point during this one. */
  overlapping: string[];
}

export interface QueryStats {
  /** `driver` with every statement counted; a no-op when disabled. */
  countStatements(driver: SqliteDriver): SqliteDriver;
  /** Run `work`, then report its span; a no-op when disabled. */
  measure<T>(label: string, work: () => Promise<T>): Promise<T>;
}

export function createQueryStats(
  enabled: boolean,
  report: (span: QuerySpan) => void,
): QueryStats {
  let statements = 0;
  // Each running span, with every label seen alongside it so far.
  const running = new Map<symbol, { label: string; seen: Set<string> }>();

  return {
    countStatements(driver) {
      if (!enabled) return driver;
      return {
        ...driver,
        exec: (sql) => {
          statements += 1;
          return driver.exec(sql);
        },
        run: (sql, params) => {
          statements += 1;
          return driver.run(sql, params);
        },
        all: <T>(sql: string, params?: unknown[]) => {
          statements += 1;
          return driver.all<T>(sql, params);
        },
        get: <T>(sql: string, params?: unknown[]) => {
          statements += 1;
          return driver.get<T>(sql, params);
        },
      };
    },

    async measure(label, work) {
      if (!enabled) return work();
      const key = Symbol(label);
      const seen = new Set<string>();
      for (const other of running.values()) {
        other.seen.add(label);
        seen.add(other.label);
      }
      running.set(key, { label, seen });
      const before = statements;
      const start = Date.now();
      try {
        return await work();
      } finally {
        running.delete(key);
        report({
          label,
          statements: statements - before,
          ms: Date.now() - start,
          overlapping: [...seen],
        });
      }
    },
  };
}

/** One line per span, greppable by its `[queries]` prefix. */
export function formatSpan(span: QuerySpan): string {
  const overlap =
    span.overlapping.length === 0
      ? ""
      : ` (overlapping: ${span.overlapping.join(", ")})`;
  return `[queries] ${span.label}: ${span.statements} statements in ${span.ms} ms${overlap}`;
}

/** On only in a bundle built with `EXPO_PUBLIC_QUERY_STATS=1`. Release builds
 *  drop console.log, so there it logs as an error to reach the device log. */
export const queryStats = createQueryStats(
  process.env.EXPO_PUBLIC_QUERY_STATS === "1",
  (span) => (__DEV__ ? console.log : console.error)(formatSpan(span)),
);
