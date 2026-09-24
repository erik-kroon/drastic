import { sql, type SQL } from "drizzle-orm";

export const legalDeliveryStatements = {
  prepareLegalDelivery: (p) =>
    sql`select openerp.prepare_ar_legal_delivery(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::jsonb) as result`,
  approveLegalDelivery: (p) =>
    sql`select openerp.approve_ar_legal_delivery(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  startLegalDeliveryAttempt: (p) =>
    sql`select openerp.start_ar_legal_delivery_attempt(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  reconcileLegalDeliveryAttempt: (p) =>
    sql`select openerp.reconcile_ar_legal_delivery_attempt(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text,${p[3]}::text,${p[4]}::jsonb) as result`,
  getLegalDelivery: (p) =>
    sql`select openerp.get_ar_legal_delivery(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
  legalDeliveryHistory: (p) =>
    sql`select openerp.ar_legal_delivery_history(${p[0]}::text,${p[1]}::jsonb,${p[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
