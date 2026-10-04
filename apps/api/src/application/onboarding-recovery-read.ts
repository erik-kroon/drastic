import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { sql } from "drizzle-orm";
import { Database } from "../db/connection";

const RecoveryRead = Schema.Struct({
  bookId: Schema.String,
  profile: Schema.Literal("synthetic-core-v1"),
  sequence: Schema.String,
  vouchers: Schema.Array(Schema.Struct({ id: Schema.String, sequence: Schema.String })),
  balances: Schema.Array(Schema.Struct({ account: Schema.String, signedMinor: Schema.String })),
  receipts: Schema.Array(Schema.Struct({ id: Schema.String, voucherId: Schema.String })),
  outbox: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      receiptId: Schema.String,
      kind: Schema.Literal("voucher.posted.v1"),
      payloadDigest: Schema.String,
      delivered: Schema.Boolean,
      attempts: Schema.String,
    }),
  ),
  originals: Schema.Array(Schema.Struct({ sha256: Schema.String, byteLength: Schema.String })),
});

export const readOnboardingRecovery = Effect.fn("onboarding.recovery.read")(function* (
  bookId: string,
) {
  const database = yield* Database;

  const result = yield* database.execute<{ body: unknown }>(
    sql`
    select jsonb_build_object('bookId',b.id,'profile',b.profile,'sequence',b.committed_sequence::text,
      'vouchers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sequence',sequence::text) order by sequence,id)
        from openerp.vouchers where book_id=b.id),'[]'::jsonb),
      'balances',coalesce((select jsonb_agg(jsonb_build_object('account',account_id,'signedMinor',amount::text) order by account_id)
        from (select account_id,sum(debit_minor-credit_minor) as amount from openerp.journal_lines where book_id=b.id group by account_id) x),'[]'::jsonb),
      'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'voucherId',voucher_id) order by id)
        from openerp.execution_receipts where book_id=b.id),'[]'::jsonb),
      'outbox',coalesce((select jsonb_agg(jsonb_build_object('id',id,'receiptId',receipt_id,'kind',kind,'payloadDigest',encode(sha256(convert_to(payload::text,'UTF8')),'hex'),'delivered',delivered_at is not null,'attempts',attempts::text) order by id) from openerp.outbox where book_id=b.id),'[]'::jsonb),
      'originals',coalesce((select jsonb_agg(jsonb_build_object('sha256',sha256,'byteLength',coalesce(byte_length,octet_length(bytes))::text) order by sha256)
        from openerp.intake_contents where book_id=b.id),'[]'::jsonb)) as body
    from openerp.books b where b.id=${bookId}`,
    "objects",
  );

  return yield* Schema.decodeUnknownEffect(RecoveryRead)(result[0]?.body);
});
