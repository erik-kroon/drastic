import { sql, type SQL } from "drizzle-orm";

export const subledgerStatements = {
  amendScheduleFutureDates: (parameters) =>
    sql`select openerp.amend_schedule_future_dates(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
