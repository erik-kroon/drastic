import type { ReactNode } from "react";
import { DataGrid } from "@open-erp/ui/components/data-grid";

export function DataTable({
  title,
  columns,
  rows,
  narrow,
  minWidth,
}: {
  title: string;
  narrow?: "scroll" | "stack";
  minWidth?: "standard" | "wide" | "fit";
  columns: { id: string; label: string; numeric?: boolean }[];
  rows: { id: string; cells: ReactNode[] }[];
}) {
  return (
    <DataGrid<{ id: string; cells: ReactNode[] }>
      title={title}
      narrow={narrow}
      minWidth={minWidth}
      rows={rows}
      getRowId={(row) => row.id}
      columns={columns.map((column, index) => ({ ...column, cell: (row) => row.cells[index] }))}
    />
  );
}
