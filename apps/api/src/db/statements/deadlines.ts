import { sql, type SQL } from "drizzle-orm";

export const deadlineStatements = {
  saveDeadline: (p: ReadonlyArray<string>) => sql`select openerp.deadline_save(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3] || null}::bigint,${p[4]}::jsonb) as result`,
  deadlineActivity: (p: ReadonlyArray<string>) => sql`select openerp.deadline_activity(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4] || null}::text) as result`,
  listDeadlines: (p: ReadonlyArray<string>) => sql`select openerp.deadline_list(${p[0]}::text,${p[1]}::jsonb) as result`,
  createDeadlineFeed: (p: ReadonlyArray<string>) => sql`select openerp.deadline_feed_create(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  revokeDeadlineFeed: (p: ReadonlyArray<string>) => sql`select openerp.deadline_feed_revoke(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  deadlineFeedEvents: (p: ReadonlyArray<string>) => sql`select openerp.deadline_feed_events(${p[0]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
