import { sql } from "drizzle-orm";

// Drizzle interpolates a JavaScript array as a SQL tuple, not a PostgreSQL array.
export function textArray(values: ReadonlyArray<string>) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}
