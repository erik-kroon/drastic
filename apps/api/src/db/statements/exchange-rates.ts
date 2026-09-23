import { sql, type SQL } from "drizzle-orm";

export const exchangeRateStatements = {
  createExchangeRate: (parameters) =>
    sql`select openerp.create_exchange_rate(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  reviseExchangeRate: (parameters) =>
    sql`select openerp.revise_exchange_rate(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  getExchangeRate: (parameters) =>
    sql`select openerp.get_exchange_rate(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  listExchangeRates: (parameters) =>
    sql`select openerp.list_exchange_rates(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
  captureConversionReview: (parameters) =>
    sql`select openerp.capture_conversion_review(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getConversionReview: (parameters) =>
    sql`select openerp.get_conversion_review(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  listConversionReviews: (parameters) =>
    sql`select openerp.list_conversion_reviews(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;
