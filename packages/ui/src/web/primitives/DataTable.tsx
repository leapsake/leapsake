import type { ReactNode } from "react";

export interface Column<T> {
  /** Column heading. Empty for the trailing actions column, which has no name. */
  header: string;
  cell: (item: T) => ReactNode;
}

/**
 * The listing table used by every section that shows rows with per-row actions —
 * milestones, relationships, contact methods, holidays.
 *
 * Its shape is always the same: named columns, then a last unnamed column
 * holding that row's links. Callers supply cell content, so what varies stays
 * with the caller and the table markup stops being written out five times.
 *
 * Columns are keyed by position because that is their identity: a table's third
 * column is the third column, and unnamed action columns have nothing else to be
 * keyed by. Rows are keyed by the caller, where the real identity lives.
 */
export function DataTable<T>({
  items,
  columns,
  getKey,
}: {
  items: readonly T[];
  columns: readonly Column<T>[];
  getKey: (item: T) => string;
}) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column, index) =>
            column.header === "" ? (
              <th key={index} />
            ) : (
              <th key={index}>{column.header}</th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={getKey(item)}>
            {columns.map((column, index) => (
              <td key={index}>{column.cell(item)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
