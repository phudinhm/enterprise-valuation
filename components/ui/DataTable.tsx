"use client";

// Tables carry a caption in the same voice as the figures, and register
// themselves for export with the values already formatted — so the report shows
// exactly the figures that were on screen.

import { useId } from "react";
import { useReport } from "@/components/report";
import { NA } from "@/lib/format";

export interface Column<T> {
  key: string;
  header: string;
  /** Returns the already-formatted cell text. */
  render: (row: T) => string;
  align?: "left" | "right";
}

export interface DataTableProps<T> {
  title: string;
  what?: string;
  columns: Column<T>[];
  rows: T[];
  /** Row identity, also used to mark the company under analysis. */
  rowKey: (row: T) => string;
  highlight?: string;
  record?: boolean;
  maxHeight?: number;
}

export default function DataTable<T>({
  title, what, columns, rows, rowKey, highlight, record = true, maxHeight,
}: DataTableProps<T>) {
  const report = useReport();
  const auto = useId();

  if (record) {
    report.add(`table:${title || auto}`, {
      kind: "table",
      title,
      what,
      table: {
        columns: columns.map((c) => c.header),
        rows: rows.map((row) => columns.map((c) => c.render(row) || NA)),
      },
    });
  }

  return (
    <div>
      {title ? (
        <div className="table-cap">
          <b>{title}.</b> {what ?? ""}
        </div>
      ) : null}
      <div className="table-wrap" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align ?? (c.key === columns[0].key ? "left" : "right") }}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = rowKey(row);
              return (
                <tr key={id} className={highlight && id === highlight ? "highlight" : undefined}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={c.align === "left" ? undefined : "table-num"}
                      style={{ textAlign: c.align ?? (c.key === columns[0].key ? "left" : "right") }}
                    >
                      {c.render(row) || NA}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
