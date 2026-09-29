import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { CommandReceipt } from "./reconciliation";
import { accountingErrors as errors } from "./accounting-errors";

// NEXT-38 owner contract: cash-method recognition and unpaid year-end cutover,
// extending the existing commerce invoice owner.
//
// A cash-method book recognizes a document when it is paid, and once-only at
// year end recognizes the unpaid remainder. The commercial balance and the
// accounting recognition stay separate throughout: paying an invoice does not
// change what is owed, and recognizing it does not create a second document.
//
// Eligibility is never inferred. A line joins cash method only because a
// reviewed profile witness says so, and the witness is retained with the line.
// Nothing in this contract infers the method from a company size, a document
// label or a relabelled accrual effect.
//
// Every recognition names the trigger that caused it. A payment recognition
// cites the payment's own identity; a year-end recognition cites a real cutover
// run. There is no recognition without one, so no amount can be recognized
// because a date arrived.

const Ref = Accounting.Identifier;

const Direction = Schema.Literals(["purchase", "sale"]);

const Rounding = Schema.Literals(["exact", "half_up"]);

export const RegisterCashMethodLine = Schema.Struct({
  invoiceId: Ref,
  sourceLineId: Ref,
  direction: Direction,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  // The reviewed witness putting this line on cash method. It is required: a
  // line with no witness is an accrual line.
  profileWitness: Accounting.Description,
  componentPolicy: Schema.Literal("tax_first_cumulative_v1"),
  rounding: Rounding,
});

export type RegisterCashMethodLine = typeof RegisterCashMethodLine.Type;

export const CashMethodLineView = Schema.Struct({
  lineId: Ref,
  invoiceId: Ref,
  sourceLineId: Ref,
  direction: Direction,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  originalGrossMinor: Accounting.AggregateMinorUnits,
  creditedGrossMinor: Accounting.AggregateMinorUnits,
  paidGrossMinor: Accounting.AggregateMinorUnits,
  recognizedGrossMinor: Accounting.AggregateMinorUnits,
  // The two open balances, both derived rather than stated. Commercial unpaid
  // is what the counterparty still owes; recognized unpaid is what the book has
  // taken but not yet been paid for.
  commercialUnpaidMinor: Accounting.AggregateMinorUnits,
  recognizedUnpaidMinor: Accounting.AggregateMinorUnits,
  profileWitness: Accounting.Description,
  // Whether the book already recognized the unpaid remainder at year end. A
  // second run over the same period is refused, so this is a fact, not a
  // guess.
  yearEndRecognized: Schema.Boolean,
  receipt: CommandReceipt,
});

export type CashMethodLineView = typeof CashMethodLineView.Type;

export const RecognizeCashPayment = Schema.Struct({
  lineId: Ref,
  // The payment's own retained identity, not a command key. A re-presented
  // payment under a new key still collides, because a payment can only
  // recognize a line once.
  paymentRef: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  // How much of the line this payment settles. It may not exceed what remains
  // commercially unpaid.
  paidGrossMinor: Accounting.AggregateMinorUnits,
  cashEvidenceId: Ref,
  settlementControlAccountId: Ref,
  expenseOrRevenueAccountId: Ref,
  taxAccountId: Ref,
  bankAccountId: Ref,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  accountingPeriodId: Ref,
  rationale: Accounting.Description,
});

export type RecognizeCashPayment = typeof RecognizeCashPayment.Type;

export const CashPaymentRecognition = Schema.Struct({
  recognitionId: Ref,
  lineId: Ref,
  paymentRef: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  // The gross this payment recognized, which is the recognized-unpaid portion
  // the payment covers, not the whole invoice.
  recognizedGrossMinor: Accounting.AggregateMinorUnits,
  recognizedGrossAfterMinor: Accounting.AggregateMinorUnits,
  paidGrossAfterMinor: Accounting.AggregateMinorUnits,
  // Commercial unpaid and recognized unpaid after the payment. These are the
  // two balances a cash-method book must keep apart.
  commercialUnpaidMinor: Accounting.AggregateMinorUnits,
  recognizedUnpaidMinor: Accounting.AggregateMinorUnits,
  netMinor: Accounting.AggregateMinorUnits,
  taxMinor: Accounting.AggregateMinorUnits,
  changeSetId: Ref,
  journalIds: Schema.Array(Ref),
  receipt: CommandReceipt,
});

export type CashPaymentRecognition = typeof CashPaymentRecognition.Type;

export const RunCashMethodYearEnd = Schema.Struct({
  accountingPeriodId: Ref,
  cutoffOn: Accounting.AccountingDate,
  postingDate: Accounting.AccountingDate,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  settlementControlAccountId: Ref,
  expenseOrRevenueAccountId: Ref,
  taxAccountId: Ref,
  // The reviewed decision and its evidence. The year-end cutover is a human
  // decision about which population is recognized unpaid, and the population
  // it consumed is recorded with it.
  rationale: Accounting.Description,
  evidenceId: Ref,
  runKey: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,128}$/)),
});

export type RunCashMethodYearEnd = typeof RunCashMethodYearEnd.Type;

export const YearEndRecognition = Schema.Struct({
  runId: Ref,
  accountingPeriodId: Ref,
  cutoffOn: Accounting.AccountingDate,
  // The population this run consumed, line by line. A second run over the same
  // period is refused, so this is the complete set for that period.
  recognizedLineCount: Schema.Int,
  recognizedGrossMinor: Accounting.AggregateMinorUnits,
  lines: Schema.Array(
    Schema.Struct({
      lineId: Ref,
      invoiceId: Ref,
      sourceLineId: Ref,
      recognizedGrossMinor: Accounting.AggregateMinorUnits,
      recognizedGrossAfterMinor: Accounting.AggregateMinorUnits,
    }),
  ).check(Schema.isMaxLength(500)),
  // The unpaid commercial balance the run deliberately did not recognize. It
  // is reported, not hidden, because that is the whole difference between a
  // cash-method year end and an accrual one.
  commercialUnpaidRemainingMinor: Accounting.AggregateMinorUnits,
  changeSetIds: Schema.Array(Ref),
  receipt: CommandReceipt,
});

export type YearEndRecognition = typeof YearEndRecognition.Type;

export const ReadCashMethodLine = Schema.Struct({ lineId: Ref });

export type ReadCashMethodLine = typeof ReadCashMethodLine.Type;

const path = "/v1/entities/:entityId/books/:bookId/commerce/cash-method";

export const CashMethodApi = HttpApiGroup.make("cashMethod")
  .add(
    HttpApiEndpoint.post("registerCashMethodLine", `${path}/lines`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: RegisterCashMethodLine.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CashMethodLineView,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("recognizeCashPayment", `${path}/payments`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: RecognizeCashPayment.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CashPaymentRecognition,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("runCashMethodYearEnd", `${path}/year-end`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: RunCashMethodYearEnd.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: YearEndRecognition,
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("readCashMethodLine", `${path}/lines/state`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: ReadCashMethodLine.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: CashMethodLineView,
      error: errors,
    }),
  );

// Agent surface. Read-only. An agent may ask how much of a document is paid,
// how much is recognized and how much remains commercially unpaid. It may not
// register a line, recognize a payment or run a year end: each of those is a
// reviewed statement about which accounting method a book uses, and the
// year-end run in particular decides a whole population's recognition.
export const CashMethodCapabilities = {
  commerce_read_cash_method_line: {
    description:
      "Read one cash-method line: its original and credited gross, the paid and recognized prefixes, and the commercial and recognized unpaid balances derived from them, with the reviewed profile witness and whether a year-end run has already recognized the unpaid remainder. A recognized-unpaid balance is what the book has taken but not yet been paid for, which is not the same as what the counterparty still owes.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ReadCashMethodLine,
    }),
    output: CashMethodLineView,
    readOnly: true,
  },
};
