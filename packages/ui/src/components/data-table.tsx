import type { ReactNode } from "react";
import { DataGrid } from "@open-erp/ui/components/data-grid";

/** Reporting adapter for preformatted cells; shares the record grid's accessible shell. */
export function DataTable({
  title,
  columns,
  rows,
  narrow,
}: {
  title: string;
  narrow?: "scroll" | "stack";
  columns: { id: string; label: string; numeric?: boolean }[];
  rows: { id: string; cells: ReactNode[] }[];
}) {
  return (
    <DataGrid<{ id: string; cells: ReactNode[] }>
      title={title}
      narrow={narrow}
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns.map((column, index) => ({ ...column, cell: (row) => row.cells[index] }))}
    />
  );
}
