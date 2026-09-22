import * as Accounting from "@open-erp/contracts/accounting";
import { sql, type SQL } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlError from "effect/unstable/sql/SqlError";
import { Database, databaseLayer } from "./db/connection";

export interface Bindings {
  readonly BETTER_AUTH_SECRET?: string;
  readonly BETTER_AUTH_URL?: string;
  readonly DATABASE_URL?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}

export class RequestEnvironment extends Context.Service<
  RequestEnvironment,
  {
    readonly bindings: Bindings;
    readonly url: URL;
  }
>()("open-erp/RequestEnvironment") {}

const messages = {
  Unauthorized: "Sign in or provide a valid API token.",
  Forbidden: "You do not have permission for this action.",
  NotFound: "The requested record was not found.",
  InvalidJournal: "The journal is invalid. Review the posting details.",
  MissingEvidence: "Add supporting evidence before continuing.",
  PeriodLocked: "The accounting period is locked.",
  StaleDependency: "The book changed. Prepare and approve a new proposal.",
  IdempotencyConflict: "This request key was already used for a different command.",
  AlreadyPosted: "This event has already been posted.",
  ApprovalRequired: "A current operator approval is required.",
  UnsupportedProfile: "This accounting profile does not support this operation.",
  Unavailable: "The accounting service is unavailable. Try again later.",
  InternalError: "The accounting service could not complete this request.",
} satisfies Record<typeof Accounting.FailureCode.Type, string>;

export function failure(code: typeof Accounting.FailureCode.Type) {
  return new Accounting.AccountingError({ code, message: messages[code] });
}

const PostgresFailure = Schema.Struct({
  code: Schema.String,
  detail: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const statements = {
  createSchedule: (parameters) =>
    sql`select openerp.create_schedule(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  listSchedules: (parameters) =>
    sql`select openerp.list_schedules(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getSchedule: (parameters) =>
    sql`select openerp.get_schedule(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  reviseSchedule: (parameters) =>
    sql`select openerp.revise_schedule(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  prepareScheduleOccurrence: (parameters) =>
    sql`select openerp.prepare_schedule_occurrence(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  declareClosingInventory: (parameters) =>
    sql`select openerp.declare_closing_inventory(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  closingReadiness: (parameters) =>
    sql`select openerp.get_closing_readiness(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  prepareClosing: (parameters) =>
    sql`select openerp.prepare_closing(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getClosingProposal: (parameters) =>
    sql`select openerp.get_closing_proposal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  approveClosing: (parameters) =>
    sql`select openerp.approve_closing(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeClosing: (parameters) =>
    sql`select openerp.execute_closing(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  closingHistory: (parameters) =>
    sql`select openerp.get_closing_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  getClosingCertificate: (parameters) =>
    sql`select openerp.get_closing_certificate(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,

  commerceCreateCounterparty: (parameters) =>
    sql`select openerp.commerce_create_counterparty(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  commerceReviseCounterparty: (parameters) =>
    sql`select openerp.commerce_revise_counterparty(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  commerceGetCounterparty: (parameters) =>
    sql`select openerp.commerce_get_counterparty(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  commerceListCounterparties: (parameters) =>
    sql`select openerp.commerce_list_counterparties(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  commerceCreateInvoice: (parameters) =>
    sql`select openerp.commerce_create_invoice(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  commerceReviseInvoice: (parameters) =>
    sql`select openerp.commerce_revise_invoice(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  commerceGetInvoice: (parameters) =>
    sql`select openerp.commerce_get_invoice(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  commerceInvoiceHistory: (parameters) =>
    sql`select openerp.commerce_invoice_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  commerceListInvoices: (parameters) =>
    sql`select openerp.commerce_list_invoices(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  commerceGetPaymentCapacity: (parameters) =>
    sql`select openerp.commerce_get_payment_capacity(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
  commercePrepareAllocation: (parameters) =>
    sql`select openerp.commerce_prepare_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  commerceGetAllocation: (parameters) =>
    sql`select openerp.commerce_get_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  commerceApproveAllocation: (parameters) =>
    sql`select openerp.commerce_approve_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  commerceApplyAllocation: (parameters) =>
    sql`select openerp.commerce_apply_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,

  prepareBankAllocation: (parameters) =>
    sql`select openerp.prepare_bank_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getBankAllocation: (parameters) =>
    sql`select openerp.get_bank_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  approveBankAllocation: (parameters) =>
    sql`select openerp.approve_bank_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeBankAllocation: (parameters) =>
    sql`select openerp.execute_bank_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  reconcileBankCapacity: (parameters) =>
    sql`select openerp.reconcile_bank_capacity(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
  getBankCapacityReconciliation: (parameters) =>
    sql`select openerp.get_bank_capacity_reconciliation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  prepareCorrectionBundle: (parameters) =>
    sql`select openerp.prepare_correction_bundle(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  getCorrectionBundle: (parameters) =>
    sql`select openerp.get_correction_bundle(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  getCorrectionBundleForVoucher: (parameters) =>
    sql`select openerp.get_correction_bundle_for_voucher(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  approveCorrectionBundle: (parameters) =>
    sql`select openerp.approve_correction_bundle(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  executeCorrectionBundle: (parameters) =>
    sql`select openerp.execute_correction_bundle(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
  listPostingRecovery: (parameters) =>
    sql`select openerp.list_posting_recovery(${parameters[0]}::text,${parameters[1]}::jsonb,NULLIF(${parameters[2]}::text,'')) as result`,
  getPostingRecovery: (parameters) =>
    sql`select openerp.get_posting_recovery(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,NULLIF(${parameters[3]}::text,'')) as result`,
  recoverPostingRequest: (parameters) =>
    sql`select openerp.recover_posting_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
  proposeRecurringRule: (parameters) =>
    sql`select openerp.propose_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getRecurringRule: (parameters) =>
    sql`select openerp.get_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  simulateRecurringRule: (parameters) =>
    sql`select openerp.simulate_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getRecurringSimulation: (parameters) =>
    sql`select openerp.get_recurring_simulation(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  activateRecurringRule: (parameters) =>
    sql`select openerp.activate_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  deactivateRecurringRule: (parameters) =>
    sql`select openerp.deactivate_recurring_rule(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  createPreparationRun: (parameters) =>
    sql`select openerp.create_preparation_run(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getPreparationRun: (parameters) =>
    sql`select openerp.get_preparation_run(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  advancePreparationRun: (parameters) =>
    sql`select openerp.advance_preparation_run(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  prepareCaseSnapshot: (parameters) =>
    sql`select openerp.prepare_case_snapshot(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  listCases: (parameters) =>
    sql`select openerp.list_cases(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getCaseContext: (parameters) =>
    sql`select openerp.get_case_context(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  bookStatus: (parameters) =>
    sql`select openerp.get_book_status(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
  importBankStatement: (parameters) =>
    sql`select openerp.import_bank_statement(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getBankStatement: (parameters) =>
    sql`select openerp.get_bank_statement(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  matchBankObservation: (parameters) =>
    sql`select openerp.match_bank_observation(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  reconcileBank: (parameters) =>
    sql`select openerp.reconcile_bank(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getBankReconciliation: (parameters) =>
    sql`select openerp.get_bank_reconciliation(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  prepareReport: (parameters) =>
    sql`select openerp.prepare_report(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getReport: (parameters) =>
    sql`select openerp.get_report(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  reportLines: (parameters) =>
    sql`select openerp.get_report_lines(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text) as result`,
  reportExplanation: (parameters) =>
    sql`select openerp.explain_report_line(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::text) as result`,
  listBooks: (parameters) => sql`select openerp.list_books(${parameters[0]}::text) as result`,
  bookSetup: (parameters) =>
    sql`select openerp.book_setup(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
  createEvidence: (parameters) =>
    sql`select openerp.create_evidence(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getEvidence: (parameters) =>
    sql`select openerp.get_evidence(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  prepareJournal: (parameters) =>
    sql`select openerp.prepare_journal(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::jsonb) as result`,
  getChange: (parameters) =>
    sql`select openerp.get_change(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  validateChange: (parameters) =>
    sql`select openerp.validate_change(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text) as result`,
  approveChange: (parameters) =>
    sql`select openerp.approve_change(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  executeChange: (parameters) =>
    sql`select openerp.execute_change(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  prepareCorrection: (parameters) =>
    sql`select openerp.prepare_correction(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text, ${parameters[3]}::text, ${parameters[4]}::jsonb) as result`,
  getVoucher: (parameters) =>
    sql`select openerp.get_voucher(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  listVouchers: (parameters) =>
    sql`select openerp.list_vouchers(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
  ledgerSnapshot: (parameters) =>
    sql`select openerp.ledger_snapshot(${parameters[0]}::text, ${parameters[1]}::jsonb) as result`,
  getReceipt: (parameters) =>
    sql`select openerp.get_receipt(${parameters[0]}::text, ${parameters[1]}::jsonb, ${parameters[2]}::text) as result`,
} satisfies Record<string, (parameters: ReadonlyArray<string>) => SQL>;

export type DatabaseOperation = keyof typeof statements;

function queryFailure(error: EffectDrizzleQueryError) {
  const nested = Cause.isCause(error.cause) ? Cause.findErrorOption(error.cause) : Option.none();
  if (Option.isNone(nested) || !SqlError.isSqlError(nested.value)) return failure("InternalError");
  const cause = nested.value.reason.cause;
  if (Schema.is(PostgresFailure)(cause)) {
    if (cause.code === "P0001" && Schema.is(Accounting.FailureCode)(cause.detail)) {
      // Expose only intentional domain messages, never Drizzle's query or bound parameters.
      return new Accounting.AccountingError({
        code: cause.detail,
        message: cause.message ?? messages[cause.detail],
      });
    }
    if (
      cause.code.startsWith("08") ||
      cause.code.startsWith("53") ||
      ["57014", "57P01", "57P02", "57P03"].includes(cause.code)
    ) {
      return failure("Unavailable");
    }
    return failure("InternalError");
  }
  return failure("Unavailable");
}

export function query<A>(
  operation: DatabaseOperation,
  parameters: Array<string>,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const { bindings } = yield* RequestEnvironment;
    const connectionString = bindings.HYPERDRIVE?.connectionString || bindings.DATABASE_URL;
    if (!connectionString) return yield* failure("Unavailable");

    return yield* Effect.gen(function* () {
      const db = yield* Database;
      const result = yield* db
        .execute<{ result: unknown }>(statements[operation](parameters), "objects")
        .pipe(Effect.mapError(queryFailure));
      return yield* Schema.decodeUnknownEffect(schema)(result[0]?.result).pipe(
        Effect.mapError(() => failure("InternalError")),
      );
    }).pipe(
      Effect.provide(
        databaseLayer({
          connectionString: Redacted.make(connectionString),
          applicationName: "open-erp-api",
          connectTimeoutMs: 5000,
          statementTimeoutMs: 15000,
        }),
      ),
      Effect.mapError((error) => (SqlError.isSqlError(error) ? failure("Unavailable") : error)),
    );
  });
}

export function scopeParameter(scope: typeof Accounting.Scope.Type) {
  return JSON.stringify({ entityId: scope.entityId, bookId: scope.bookId });
}
