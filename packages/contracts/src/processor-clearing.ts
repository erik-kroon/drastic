import * as Schema from "effect/Schema";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CurrencyCode, CurrencyScale } from "@open-erp/domain/exchange-rates";
import { MinorUnits, SignedMinorUnits } from "@open-erp/domain/money";
import { ClearingJournalLine } from "@open-erp/domain/processor-clearing";

const ProviderId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

const Profile = Schema.Literal("synthetic_stripe_balance_v1");

const roles = {
  processorControlAccountId: Accounting.Identifier,
  payoutTransitAccountId: Accounting.Identifier,
  feeCostAccountId: Accounting.Identifier,
  disputeReceivableAccountId: Accounting.Identifier,
  disputeLossAccountId: Accounting.Identifier,
  bankAccountId: Accounting.Identifier,
  gainAccountId: Accounting.Identifier,
  lossAccountId: Accounting.Identifier,
};

export const RegisterAccount = Schema.Struct({
  profile: Profile,
  providerAccountId: ProviderId,
  liveMode: Schema.Boolean,
  currency: CurrencyCode,
  currencyScale: CurrencyScale,
  openedOn: Accounting.AccountingDate,
  ...roles,
  evidenceId: Accounting.Identifier,
  acknowledgeLimitedProfile: Schema.Literal(true),
  acknowledgeGrossFeesWithoutInputVat: Schema.Literal(true),
});

export const Account = Schema.Struct({
  ...RegisterAccount.fields,
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  digest: Accounting.Digest,
  createdAt: Schema.String,
});

export const NativeCreditEvidence = Schema.Struct({
  kind: Schema.Literal("synthetic_native_processor_credit_v1"),
  customerId: Accounting.Identifier,
  currency: CurrencyCode,
  currencyScale: CurrencyScale,
  nativeMinor: MinorUnits.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  liabilityAccountId: Accounting.Identifier,
  receivableAccountId: Accounting.Identifier,
  voucherId: Accounting.Identifier,
  lineId: Accounting.Identifier,
});

export const RegisterNativeCredit = Schema.Struct({
  accountId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
});

export const NativeCreditOrigin = Schema.Struct({
  id: Accounting.Identifier,
  accountId: Accounting.Identifier,
  customerId: Accounting.Identifier,
  currency: CurrencyCode,
  currencyScale: CurrencyScale,
  originalNativeMinor: MinorUnits,
  originalCarryingMinor: MinorUnits,
  liabilityAccountId: Accounting.Identifier,
  receivableAccountId: Accounting.Identifier,
  sourceVoucherId: Accounting.Identifier,
  sourceLineId: Accounting.Identifier,
  evidenceId: Accounting.Identifier,
  evidenceDigest: Accounting.Digest,
  digest: Accounting.Digest,
});

export const FetchSelection = Schema.Union([
  Schema.Struct({
    startsOn: Accounting.AccountingDate,
    endsOn: Accounting.AccountingDate,
    view: Schema.Literal("balance"),
  }),
  Schema.Struct({
    startsOn: Accounting.AccountingDate,
    endsOn: Accounting.AccountingDate,
    view: Schema.Literal("automatic_payout"),
    providerPayoutId: ProviderId,
  }),
]);

export const ProviderRow = Schema.Struct({
  id: ProviderId,
  sourceId: ProviderId,
  type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  currency: CurrencyCode,
  currencyScale: CurrencyScale,
  grossMinor: SignedMinorUnits,
  feeMinor: SignedMinorUnits,
  netMinor: SignedMinorUnits,
  occurredOn: Accounting.AccountingDate,
  availableOn: Accounting.AccountingDate,
  providerPayoutId: Schema.NullOr(ProviderId),
  disputeId: Schema.NullOr(ProviderId),
  payoutMethod: Schema.NullOr(Schema.Literals(["automatic", "manual"])),
  destinationBankAccountId: Schema.NullOr(ProviderId),
});

export const ProviderPage = Schema.Struct({
  profile: Profile,
  accountId: ProviderId,
  liveMode: Schema.Boolean,
  currency: CurrencyCode,
  currencyScale: CurrencyScale,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  view: Schema.Literals(["balance", "automatic_payout"]),
  providerPayoutId: Schema.NullOr(ProviderId),
  cursor: Schema.NullOr(ProviderId),
  nextCursor: Schema.NullOr(ProviderId),
  reportId: ProviderId,
  openingMinor: SignedMinorUnits,
  closingMinor: SignedMinorUnits,
  complete: Schema.Boolean,
  rows: Schema.Array(ProviderRow).check(Schema.isMaxLength(100)),
});

export const Observation = Schema.Struct({
  ...ProviderRow.fields,
  id: Accounting.Identifier,
  accountId: Accounting.Identifier,
  balanceTransactionId: ProviderId,
  rawSourceRef: Accounting.Identifier,
  semanticDigest: Accounting.Digest,
  classification: Schema.Literals(["supported", "requires_classification"]),
  blocker: Schema.NullOr(Schema.String),
});

export const Fetch = Schema.Struct({
  id: Accounting.Identifier,
  accountId: Accounting.Identifier,
  selection: FetchSelection,
  profileDigest: Accounting.Digest,
  rawSourceRefs: Schema.Array(Accounting.Identifier),
  reportId: ProviderId,
  openingMinor: SignedMinorUnits,
  closingMinor: SignedMinorUnits,
  providerComplete: Schema.Boolean,
  observations: Schema.Array(Observation),
  digest: Accounting.Digest,
});

const common = {
  accountId: Accounting.Identifier,
  date: Accounting.AccountingDate,
  accountingPeriodId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  evidenceId: Accounting.Identifier,
  reason: Accounting.Description,
  acknowledgeLimitedProfile: Schema.Literal(true),
};

export const BankObservation = Schema.Struct({
  statementId: Accounting.Identifier,
  rowOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

export const Prepare = Schema.Union([
  Schema.Struct({
    ...common,
    kind: Schema.Literal("observation"),
    observationId: Accounting.Identifier,
    invoiceId: Schema.optional(Accounting.Identifier),
    creditOriginId: Schema.optional(Accounting.Identifier),
    fxItemId: Schema.optional(Accounting.Identifier),
    rateObservationId: Schema.optional(Accounting.Identifier),
    rateDigest: Schema.optional(Accounting.Digest),
  }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal("bank_receipt"),
    payoutObservationId: Accounting.Identifier,
    bankObservation: BankObservation,
    adoptedVoucherId: Schema.optional(Accounting.Identifier),
    adoptedBankLineId: Schema.optional(Accounting.Identifier),
  }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal("payout_failure"),
    payoutObservationId: Accounting.Identifier,
    failureObservationId: Accounting.Identifier,
    nonSettlementEvidenceId: Accounting.Identifier,
  }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal("dispute_loss"),
    observationId: Accounting.Identifier,
  }),
]);

export const CashEffect = Schema.Struct({
  accountId: Accounting.Identifier,
  capacityVersion: Accounting.Digest,
  nativeDeltaMinor: SignedMinorUnits,
  carryingDeltaMinor: SignedMinorUnits,
});

export const ObligationEffect = Schema.Struct({
  kind: Schema.Literals([
    "receivable",
    "customer_credit",
    "foreign_receivable",
    "native_customer_credit",
  ]),
  sourceId: Accounting.Identifier,
  capacityVersion: Accounting.Digest,
  nativeMinor: MinorUnits,
  carryingMinor: MinorUnits,
  accountId: Accounting.Identifier,
});

export const Review = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  actorId: Accounting.Identifier,
  version: Schema.Literal(1),
  input: Prepare,
  sourceIdentity: Schema.String.check(Schema.isMaxLength(4096)),
  snapshot: Schema.JsonObject,
  journal: Schema.Array(ClearingJournalLine),
  cashEffects: Schema.Array(CashEffect),
  obligation: Schema.NullOr(ObligationEffect),
  postingAction: Schema.NullOr(Schema.JsonObject),
  fiscalYearId: Accounting.Identifier,
  bookCurrency: CurrencyCode,
  digest: Accounting.Digest,
  createdAt: Schema.String,
});

export const Approve = Schema.Struct({ version: Schema.Literal(1), digest: Accounting.Digest });

export const Execute = Schema.Struct({ ...Approve.fields, approvalId: Accounting.Identifier });

export const Approval = Schema.Struct({
  id: Accounting.Identifier,
  reviewId: Accounting.Identifier,
  actorId: Accounting.Identifier,
  digest: Accounting.Digest,
  expiresAt: Schema.String,
});

export const Execution = Schema.Struct({
  reviewId: Accounting.Identifier,
  digest: Accounting.Digest,
  sourceIdentity: Schema.String,
  voucherId: Schema.NullOr(Accounting.Identifier),
  obligation: Schema.NullOr(ObligationEffect),
  cashEffects: Schema.Array(CashEffect),
});

export const Reconciliation = Schema.Struct({
  accountId: Accounting.Identifier,
  fetchId: Accounting.Identifier,
  processorNativeMinor: SignedMinorUnits,
  processorLedgerMinor: SignedMinorUnits,
  providerClosingMinor: SignedMinorUnits,
  processorNativeDifferenceMinor: SignedMinorUnits,
  processorBookDifferenceMinor: SignedMinorUnits,
  transitNativeMinor: SignedMinorUnits,
  transitLedgerMinor: SignedMinorUnits,
  transitBookDifferenceMinor: SignedMinorUnits,
  payouts: Schema.Array(
    Schema.Struct({
      payoutObservationId: Accounting.Identifier,
      nativeMinor: SignedMinorUnits,
      carryingMinor: SignedMinorUnits,
    }),
  ),
  blockers: Schema.Array(Schema.String),
  complete: Schema.Boolean,
});

export const NonSettlementEvidence = Schema.Struct({
  kind: Schema.Literal("synthetic_processor_nonsettlement_v1"),
  providerAccountId: ProviderId,
  providerPayoutId: ProviderId,
  failureBalanceTransactionId: ProviderId,
  bankAccountId: Accounting.Identifier,
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
  cashDidNotSettle: Schema.Literal(true),
  statementId: Accounting.Identifier,
});

const path = "/v1/entities/:entityId/books/:bookId/banking/processors";

const identified = { params: Accounting.ChangePath, error: accountingErrors };

const mutation = { headers: Accounting.IdempotencyHeaders, error: accountingErrors };

export const ProcessorClearingApi = HttpApiGroup.make("processorClearing")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiEndpoint.post("registerProcessorNativeCredit", `${path}/native-credit-origins`, {
      ...mutation,
      params: Accounting.Scope,
      payload: RegisterNativeCredit,
      success: NativeCreditOrigin,
    }),
    HttpApiEndpoint.post("registerProcessorAccount", `${path}/accounts`, {
      ...mutation,
      params: Accounting.Scope,
      payload: RegisterAccount,
      success: Account,
    }),
    HttpApiEndpoint.get("getProcessorAccount", `${path}/accounts/:id`, {
      ...identified,
      success: Account,
    }),
    HttpApiEndpoint.post("fetchProcessorObservations", `${path}/accounts/:id/fetches`, {
      ...identified,
      ...mutation,
      payload: FetchSelection,
      success: Fetch,
    }),
    HttpApiEndpoint.get("getProcessorFetch", `${path}/fetches/:id`, {
      ...identified,
      success: Fetch,
    }),
    HttpApiEndpoint.post("prepareProcessorClearing", `${path}/reviews`, {
      ...mutation,
      params: Accounting.Scope,
      payload: Prepare,
      success: Review,
    }),
    HttpApiEndpoint.get("getProcessorReview", `${path}/reviews/:id`, {
      ...identified,
      success: Review,
    }),
    HttpApiEndpoint.post("approveProcessorClearing", `${path}/reviews/:id/approvals`, {
      ...identified,
      ...mutation,
      payload: Approve,
      success: Approval,
    }),
    HttpApiEndpoint.post("executeProcessorClearing", `${path}/reviews/:id/execute`, {
      ...identified,
      ...mutation,
      payload: Execute,
      success: Execution,
    }),
    HttpApiEndpoint.get(
      "reconcileProcessorClearing",
      `${path}/accounts/:id/reconciliation/:fetchId`,
      {
        params: Schema.Struct({ ...Accounting.ChangePath.fields, fetchId: Accounting.Identifier }),
        error: accountingErrors,
        success: Reconciliation,
      },
    ),
  );

const command = {
  scope: Accounting.Scope,
  idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
};

export const ProcessorClearingCapabilities = {
  banking_register_processor_native_credit: {
    input: Schema.Struct({ ...command, input: RegisterNativeCredit }),
    output: NativeCreditOrigin,
    description:
      "Adopt a qualified retained native credit source and its actual posted liability carrying.",
    readOnly: false,
    agentCallable: false,
  },
  banking_register_processor_account: {
    input: Schema.Struct({ ...command, input: RegisterAccount }),
    output: Account,
    description: "Configure a qualified synthetic processor partition and owned control accounts.",
    readOnly: false,
    agentCallable: false,
  },
  banking_fetch_processor_observations: {
    input: Schema.Struct({ ...command, accountId: Accounting.Identifier, input: FetchSelection }),
    output: Fetch,
    description: "Fetch and retain a bounded processor interval without financial posting.",
    readOnly: false,
  },
  banking_prepare_processor_clearing: {
    input: Schema.Struct({ ...command, input: Prepare }),
    output: Review,
    description:
      "Seal processor clearing from retained observations and canonical commerce capacity.",
    readOnly: false,
  },
  banking_approve_processor_clearing: {
    input: Schema.Struct({ ...command, reviewId: Accounting.Identifier, input: Approve }),
    output: Approval,
    description: "Human approval of the exact retained processor review.",
    readOnly: false,
    agentCallable: false,
  },
  banking_execute_processor_clearing: {
    input: Schema.Struct({ ...command, reviewId: Accounting.Identifier, input: Execute }),
    output: Execution,
    description:
      "Atomically post approved processor clearing and consume the retained financial sources.",
    readOnly: false,
  },
  banking_get_processor_account: {
    input: Schema.Struct({ scope: Accounting.Scope, accountId: Accounting.Identifier }),
    output: Account,
    description: "Read the qualified processor partition and role bindings.",
    readOnly: true,
  },
  banking_get_processor_review: {
    input: Schema.Struct({ scope: Accounting.Scope, reviewId: Accounting.Identifier }),
    output: Review,
    description: "Read the exact retained processor review.",
    readOnly: true,
  },
  banking_get_processor_fetch: {
    input: Schema.Struct({ scope: Accounting.Scope, fetchId: Accounting.Identifier }),
    output: Fetch,
    description: "Read retained pages, observations and independent processor controls.",
    readOnly: true,
  },
  banking_reconcile_processor_clearing: {
    input: Schema.Struct({
      scope: Accounting.Scope,
      accountId: Accounting.Identifier,
      fetchId: Accounting.Identifier,
    }),
    output: Reconciliation,
    description:
      "Compare independent processor and payout transit controls against owned effects and GL.",
    readOnly: true,
  },
};
