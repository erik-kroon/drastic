import { sql, type SQL } from "drizzle-orm";

export const dimensionStatements = {
  listDimensions: (p) => sql`select openerp.list_dimensions(${p[0]}::text,${p[1]}::jsonb) as result`,
  saveDimension: (p) => sql`select openerp.save_dimension(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  saveDimensionValue: (p) => sql`select openerp.save_dimension_value(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
