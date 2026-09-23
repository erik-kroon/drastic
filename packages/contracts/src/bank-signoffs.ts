import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt } from "./reconciliation";

export const PrepareBankSignoff = Schema.Struct({
  coverageReportId: A.Identifier,
  reconciliationId: A.Identifier,
});
export const BankSignoffPlan = Schema.Struct({
  id: A.Identifier,
  version: Schema.Literal(1),
  scope: A.Scope,
  input: PrepareBankSignoff,
  accountId: A.Identifier,
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  currency: Schema.String,
  currencyScale: Schema.Int,
  basis: Schema.Struct({
    inventoryId: A.Identifier,
    inventoryDigest: A.Digest,
    coverageDigest: A.Digest,
    reconciliationDigest: A.Digest,
    statementDigest: A.Digest,
    allocationDigest: A.Digest,
    dependencyDigest: A.Digest,
    sourceRevision: A.MinorUnits,
    ledgerSequence: A.MinorUnits,
    accountLedgerSequence: A.MinorUnits,
    checkVersion: Schema.Literal("bank_signoff_v1"),
  }),
  reviewScope: Schema.Literal("selected_declared_bank_account"),
  coverage: Schema.Literal("not_established"),
  financialCloseReady: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: A.Digest,
});
export const SignBankReconciliation = Schema.Struct({
  digest: A.Digest,
  version: Schema.Literal(1),
  evidenceId: A.Identifier,
  rationale: A.Description,
});
export const BankReconciliationSignoff = Schema.Struct({
  ...SignBankReconciliation.fields,
  planId: A.Identifier,
  evidenceSha256: Schema.String,
  actorId: A.Identifier,
  signedAt: Schema.String,
  receipt: CommandReceipt,
});
export const BankSignoffView = Schema.Struct({
  plan: BankSignoffPlan,
  signoff: Schema.NullOr(BankReconciliationSignoff),
  dependenciesCurrent: Schema.Boolean,
  artifact: Schema.NullOr(
    Schema.Struct({
      content: Schema.String,
      sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
      byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1048576 })),
      mediaType: Schema.Literal("application/json"),
    }),
  ),
});
export const BankSignoffList = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      accountId: A.Identifier,
      startsOn: A.AccountingDate,
      endsOn: A.AccountingDate,
      createdAt: Schema.String,
      digest: A.Digest,
      signedAt: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(200)),
});
const path = "/v1/entities/:entityId/books/:bookId/bank-signoff-plans";
export const BankSignoffApi = HttpApiGroup.make("bankSignoffs").add(
  HttpApiEndpoint.post("prepareBankSignoff", path, {
    params: A.Scope,
    headers: A.IdempotencyHeaders,
    payload: PrepareBankSignoff.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankSignoffPlan,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("signBankReconciliation", `${path}/:id/sign`, {
    params: A.ChangePath,
    headers: A.IdempotencyHeaders,
    payload: SignBankReconciliation.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankReconciliationSignoff,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getBankSignoff", `${path}/:id`, {
    params: A.ChangePath,
    success: BankSignoffView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("listBankSignoffs", path, {
    params: A.Scope,
    success: BankSignoffList,
    error: accountingErrors,
  }),
);
// Human signoff remains operator-only REST, not an ordinary automation capability.
export const BankSignoffCapabilities = {
  bank_prepare_signoff: {
    description:
      "Pin current evidenced source coverage and capacity reconciliation for one declared account. Does not sign, post or establish complete company coverage.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareBankSignoff,
    }),
    output: BankSignoffPlan,
    readOnly: false,
  },
  bank_get_signoff: {
    description:
      "Recover immutable bank signoff basis, operator attestation and exact artifact bytes with separate live currentness. Stale signoffs are historical, not current authority.",
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: BankSignoffView,
    readOnly: true,
  },
  bank_list_signoffs: {
    description:
      "Discover bounded bank signoff preparation and signing history. Read each plan for its current dependency status.",
    input: Schema.Struct({ scope: A.Scope }),
    output: BankSignoffList,
    readOnly: true,
  },
};
