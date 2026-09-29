import type { ReactNode } from "react";

export interface Column<T> {
  /** Column heading; empty for the trailing actions column. */
  header: string;
  cell: (item: T) => ReactNode;
}

/** Named columns, then an unnamed one of per-row links. Columns are keyed by
 *  position; rows by the caller. */
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
