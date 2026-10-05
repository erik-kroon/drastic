import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import * as Domain from "@open-erp/domain/historical-adoptions";
import { accountingErrors } from "./accounting-errors";

export const CreatePool = Schema.Struct({
  admissionId: A.Identifier,
  admissionDigest: A.Digest,
  basisFiscalYearId: A.Identifier,
  cutoverOn: A.AccountingDate,
  sourceAccount: Schema.String,
  direction: Domain.PoolDirection,
  rationale: A.Description,
});

export const Pool = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  input: CreatePool,
  sourcePlanId: A.Identifier,
  sourceSystem: Schema.String,
  basisMode: Domain.FinancialBasis,
  controlAccountId: A.Identifier,
  currency: Schema.String,
  exactResidualMinor: A.MinorUnits,
  partitionDigest: A.Digest,
  sourceItems: Schema.Array(Domain.SourceItem),
  basisDigest: A.Digest,
  digest: A.Digest,
  createdBy: A.Identifier,
  createdAt: Schema.String,
});

export const PrepareAdoption = Schema.Struct({
  poolId: A.Identifier,
  poolDigest: A.Digest,
  sourceIdentity: Schema.String,
  rationale: A.Description,
});

export const AdoptionPlan = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  input: PrepareAdoption,
  poolVersion: Schema.String,
  capturedPool: Schema.optional(Pool),
  plan: Domain.HistoricalAdoptionPlan,
  digest: A.Digest,
  createdBy: A.Identifier,
  createdAt: Schema.String,
});

export const Approve = Schema.Struct({ digest: A.Digest });

export const Execute = Schema.Struct({ digest: A.Digest, approvalId: A.Identifier });

export const Approval = Schema.Struct({
  id: A.Identifier,
  planId: A.Identifier,
  planDigest: A.Digest,
  actorId: A.Identifier,
  expiresAt: Schema.String,
  createdAt: Schema.String,
});

export const Adoption = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  planId: A.Identifier,
  poolId: A.Identifier,
  sourceIdentity: Schema.String,
  liveObligationId: A.Identifier,
  openingResidualMinor: A.MinorUnits,
  sourceItem: Domain.SourceItem,
  approvalId: A.Identifier,
  journalIds: Schema.Array(A.Identifier),
  glDeltaMinor: A.MinorUnits,
  createdAt: Schema.String,
});

export const Obligation = Schema.Struct({
  adoption: Adoption,
  remainingMinor: A.MinorUnits,
  settledMinor: A.MinorUnits,
  version: Schema.String,
  creditSupport: Schema.Literal("original_tax_detail_required"),
});

export const PoolControl = Schema.Struct({
  pool: Pool,
  adoptedMinor: A.MinorUnits,
  unadoptedMinor: A.MinorUnits,
  liveMinor: A.MinorUnits,
  settledMinor: A.MinorUnits,
  complete: Schema.Boolean,
  version: Schema.String,
});

export const RereviewPool = Schema.Struct({
  expectedPoolDigest: A.Digest,
  admissionId: A.Identifier,
  admissionDigest: A.Digest,
  rationale: A.Description,
});

export const PoolRevision = Schema.Struct({
  id: A.Identifier,
  poolId: A.Identifier,
  ordinal: Schema.Int,
  input: RereviewPool,
  pool: Pool,
  digest: A.Digest,
  createdBy: A.Identifier,
  createdAt: Schema.String,
});

export const AdoptionWorkspace = Schema.Struct({
  plan: AdoptionPlan,
  preparedPool: Pool,
  currentPool: Pool,
  revision: Schema.NullOr(PoolRevision),
  approvals: Schema.Array(Approval),
  adoption: Schema.NullOr(Adoption),
  glMinor: A.SignedMinorUnits,
  differenceMinor: A.SignedMinorUnits,
  stale: Schema.Boolean,
  sourceOccurrenceId: A.Identifier,
  currentSourceOccurrenceId: A.Identifier,
  currentSourcePlanId: A.Identifier,
  currentPreviewId: A.Identifier,
  reviewerName: Schema.NullOr(Schema.String),
  adoptedMinor: A.MinorUnits,
  originalUnadoptedMinor: A.MinorUnits,
});

export const AdoptionPageQuery = Schema.Struct({ after: Schema.optional(A.Identifier) });

export const AdoptionPage = Schema.Struct({
  scope: A.Scope,
  items: Schema.Array(AdoptionPlan),
  next: Schema.NullOr(A.Identifier),
});

export const PrepareSettlement = Schema.Struct({
  adoptionId: A.Identifier,
  expectedVersion: Schema.String,
  paymentVoucherId: A.Identifier,
  paymentLineId: A.Identifier,
  amountMinor: A.MinorUnits,
  rationale: A.Description,
});

export const SettlementPlan = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  input: PrepareSettlement,
  controlAccountId: A.Identifier,
  direction: Domain.PoolDirection,
  paymentCapacityVersion: Schema.String,
  remainingAfterMinor: A.MinorUnits,
  digest: A.Digest,
  createdBy: A.Identifier,
  createdAt: Schema.String,
});

export const Settlement = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  planId: A.Identifier,
  adoptionId: A.Identifier,
  paymentVoucherId: A.Identifier,
  paymentLineId: A.Identifier,
  amountMinor: A.MinorUnits,
  remainingMinor: A.MinorUnits,
  approvalId: A.Identifier,
  journalIds: Schema.Array(A.Identifier),
  createdAt: Schema.String,
});

const base = "/v1/entities/:entityId/books/:bookId";

const identified = { params: A.ChangePath, error: accountingErrors };

const mutation = { ...identified, headers: A.IdempotencyHeaders };

export const HistoricalAdoptionsApi = HttpApiGroup.make("historicalAdoptions")
  .add(
    HttpApiEndpoint.post("rereviewHistoricalPool", `${base}/historical-pools/:id/revisions`, {
      ...mutation,
      payload: RereviewPool,
      success: PoolRevision,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "getHistoricalAdoptionWorkspace",
      `${base}/historical-adoption-plans/:id/workspace`,
      {
        ...identified,
        success: AdoptionWorkspace,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("listHistoricalAdoptionPlans", `${base}/historical-adoption-plans`, {
      params: A.Scope,
      query: AdoptionPageQuery,
      success: AdoptionPage,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("createHistoricalPool", `${base}/historical-pools`, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: CreatePool,
      success: Pool,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getHistoricalPool", `${base}/historical-pools/:id`, {
      ...identified,
      success: PoolControl,
    }),
  )
  .add(
    HttpApiEndpoint.post("prepareHistoricalAdoption", `${base}/historical-adoption-plans`, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: PrepareAdoption,
      success: AdoptionPlan,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getHistoricalAdoptionPlan", `${base}/historical-adoption-plans/:id`, {
      ...identified,
      success: AdoptionPlan,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "approveHistoricalAdoption",
      `${base}/historical-adoption-plans/:id/approvals`,
      { ...mutation, payload: Approve, success: Approval },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "executeHistoricalAdoption",
      `${base}/historical-adoption-plans/:id/execute`,
      { ...mutation, payload: Execute, success: Adoption },
    ),
  )
  .add(
    HttpApiEndpoint.get("getHistoricalObligation", `${base}/historical-obligations/:id`, {
      ...identified,
      success: Obligation,
    }),
  )
  .add(
    HttpApiEndpoint.post("prepareHistoricalSettlement", `${base}/historical-settlement-plans`, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: PrepareSettlement,
      success: SettlementPlan,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getHistoricalSettlementPlan", `${base}/historical-settlement-plans/:id`, {
      ...identified,
      success: SettlementPlan,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "approveHistoricalSettlement",
      `${base}/historical-settlement-plans/:id/approvals`,
      { ...mutation, payload: Approve, success: Approval },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "executeHistoricalSettlement",
      `${base}/historical-settlement-plans/:id/execute`,
      { ...mutation, payload: Execute, success: Settlement },
    ),
  )
  .add(
    HttpApiEndpoint.post("prepareHistoricalCredit", `${base}/historical-obligations/:id/credits`, {
      ...mutation,
      payload: Schema.Struct({ rationale: A.Description }),
      success: A.ChangeSet,
    }),
  );
