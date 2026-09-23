import { sql, type SQL } from "drizzle-orm";

export const preparationJobStopStatements = {
  stopPreparationJob: (parameters) =>
    sql`select openerp.stop_preparation_job(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
