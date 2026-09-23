import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { ClosingInventory } from "./closing";
import { CommandReceipt } from "./reconciliation";
import {
  BankSignoffPlan,
  BankReconciliationSignoff,
  SignBankReconciliation,
} from "./bank-signoffs";

export const PrepareBankInventorySignoff = Schema.Struct({
  inventoryId: A.Identifier,
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  signoffPlanIds: Schema.Array(A.Identifier).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
const ArtifactIdentity = Schema.Struct({
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8388608 })),
  mediaType: Schema.Literal("application/json"),
});
const Artifact = Schema.Struct({ ...ArtifactIdentity.fields, content: Schema.String });
export const BankInventorySignoffPlan = Schema.Struct({
  id: A.Identifier,
  version: Schema.Literal(1),
  scope: A.Scope,
  input: PrepareBankInventorySignoff,
  periodId: A.Identifier,
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  currency: Schema.String,
  currencyScale: Schema.Int,
  inventory: ClosingInventory,
  members: Schema.Array(
    Schema.Struct({
      accountId: A.Identifier,
      plan: BankSignoffPlan,
      signoff: BankReconciliationSignoff,
      artifact: ArtifactIdentity,
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  basis: Schema.Struct({
    inventoryId: A.Identifier,
    inventoryDigest: A.Digest,
    dependencyDigest: A.Digest,
    memberDigest: A.Digest,
    ledgerSequence: A.MinorUnits,
    checkVersion: Schema.Literal("declared_bank_inventory_signoff_v1"),
  }),
  reviewScope: Schema.Literal("whole_declared_bank_inventory"),
  coverage: Schema.Literal("declared_inventory_only"),
  companyCompleteness: Schema.Literal("not_established"),
  financialCloseReady: Schema.Literal(false),
  createdAt: Schema.String,
  receipt: CommandReceipt,
  digest: A.Digest,
});
export const SignBankInventory = SignBankReconciliation;
export const BankInventorySignoff = BankReconciliationSignoff;
export const BankInventorySignoffView = Schema.Struct({
  plan: BankInventorySignoffPlan,
  signoff: Schema.NullOr(BankInventorySignoff),
  preparedArtifact: Artifact,
  signedArtifact: Schema.NullOr(Artifact),
  dependenciesCurrent: Schema.Boolean,
});
export const BankInventorySignoffList = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(
    Schema.Struct({
      id: A.Identifier,
      inventoryId: A.Identifier,
      periodId: A.Identifier,
      startsOn: A.AccountingDate,
      endsOn: A.AccountingDate,
      accountCount: Schema.Int,
      createdAt: Schema.String,
      digest: A.Digest,
      signedAt: Schema.NullOr(Schema.String),
    }),
  ).check(Schema.isMaxLength(200)),
});
const path = "/v1/entities/:entityId/books/:bookId/bank-inventory-signoff-plans";
export const BankInventorySignoffApi = HttpApiGroup.make("bankInventorySignoffs").add(
  HttpApiEndpoint.post("prepareBankInventorySignoff", path, {
    params: A.Scope,
    headers: A.IdempotencyHeaders,
    payload: PrepareBankInventorySignoff.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankInventorySignoffPlan,
    error: accountingErrors,
  }),
  HttpApiEndpoint.post("signBankInventory", `${path}/:id/sign`, {
    params: A.ChangePath,
    headers: A.IdempotencyHeaders,
    payload: SignBankInventory.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: BankInventorySignoff,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("getBankInventorySignoff", `${path}/:id`, {
    params: A.ChangePath,
    success: BankInventorySignoffView,
    error: accountingErrors,
  }),
  HttpApiEndpoint.get("listBankInventorySignoffs", path, {
    params: A.Scope,
    success: BankInventorySignoffList,
    error: accountingErrors,
  }),
);
// Whole-inventory signing remains operator-only REST, never an MCP approval tool.
export const BankInventorySignoffCapabilities = {
  bank_prepare_inventory_signoff: {
    description:
      "Capture the complete latest declared bank inventory and one current already-signed account artifact per declared account for the same whole period/cutoff. Does not sign, reconcile, post, waive or establish company completeness.",
    input: Schema.Struct({
      scope: A.Scope,
      idempotencyKey: A.IdempotencyHeaders.fields["idempotency-key"],
      input: PrepareBankInventorySignoff,
    }),
    output: BankInventorySignoffPlan,
    readOnly: false,
  },
  bank_get_inventory_signoff: {
    description:
      "Recover exact prepared/signed whole-declared-bank-inventory JSON bytes and separate live currentness. Historical signoffs are not current authority or financial close readiness.",
    input: Schema.Struct({ scope: A.Scope, id: A.Identifier }),
    output: BankInventorySignoffView,
    readOnly: true,
  },
  bank_list_inventory_signoffs: {
    description:
      "Discover all bounded retained whole-declared-bank-inventory signoff captures after reload or uncertain responses. Read each capture for currentness.",
    input: Schema.Struct({ scope: A.Scope }),
    output: BankInventorySignoffList,
    readOnly: true,
  },
};
