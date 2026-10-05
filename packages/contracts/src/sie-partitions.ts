import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as A from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { DimensionCode, DimensionValueCode } from "@open-erp/domain/dimensions";

export const FiscalMapping = Schema.Struct({
  sourceYear: Schema.String.check(Schema.isPattern(/^-?[0-9]{1,4}$/)),
  fiscalYearId: A.Identifier,
});

export const DimensionMapping = Schema.Struct({
  sourceDimensionId: Schema.String.check(Schema.isPattern(/^[0-9]{1,4}$/)),
  dimensionCode: DimensionCode,
});

export const ObjectMapping = Schema.Struct({
  sourceDimensionId: DimensionMapping.fields.sourceDimensionId,
  sourceObjectCode: DimensionValueCode,
  valueCode: DimensionValueCode,
});

export const PreparePartition = Schema.Struct({
  previewId: A.Identifier,
  previewDigest: A.Digest,
  sourcePlanId: A.Identifier,
  sourcePlanDigest: A.Digest,
  fiscalMappings: Schema.Array(FiscalMapping).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  dimensionMappings: Schema.Array(DimensionMapping).check(Schema.isMaxLength(64)),
  objectMappings: Schema.Array(ObjectMapping).check(Schema.isMaxLength(500)),
  dialect: Schema.Literal("synthetic_sie4_final_trans_v1"),
  rationale: A.Description,
});

export const AccountControl = Schema.Struct({
  sourceAccount: Schema.String,
  accountId: A.Identifier,
  openingMinor: A.SignedMinorUnits,
  movementMinor: A.SignedMinorUnits,
  closingMinor: A.SignedMinorUnits,
});

export const ObjectControl = Schema.Struct({
  sourceAccount: Schema.String,
  accountId: A.Identifier,
  sourceDimensionId: DimensionMapping.fields.sourceDimensionId,
  sourceObjectCode: DimensionValueCode,
  dimensionCode: DimensionCode,
  valueCode: DimensionValueCode,
  openingMinor: A.SignedMinorUnits,
  movementMinor: A.SignedMinorUnits,
  closingMinor: A.SignedMinorUnits,
});

export const YearPartition = Schema.Struct({
  sourceYear: FiscalMapping.fields.sourceYear,
  sourceYearOrdinal: Schema.Int,
  fiscalYearId: A.Identifier,
  startsOn: A.AccountingDate,
  endsOn: A.AccountingDate,
  voucherOrdinals: Schema.Array(Schema.Int),
  controls: Schema.Array(AccountControl),
  objectControls: Schema.Array(ObjectControl),
});

export const VoucherMember = Schema.Struct({
  ordinal: Schema.Int,
  sourceYearOrdinal: Schema.Int,
  scopedIdentity: Schema.String,
  accountingOn: A.AccountingDate,
  sourceDigest: A.Digest,
  historyDigest: A.Digest,
  sourceReference: Schema.String,
  dimensionPolicy: A.PrepareJournal.fields.dimensionPolicy,
  lines: A.PrepareJournal.fields.lines,
});

export const Partition = Schema.Struct({
  id: A.Identifier,
  scope: A.Scope,
  input: PreparePartition,
  sourceSha256: A.Digest,
  years: Schema.Array(YearPartition),
  vouchers: Schema.Array(VoucherMember),
  membershipDigest: A.Digest,
  digest: A.Digest,
  createdBy: A.Identifier,
  createdAt: Schema.String,
});

const base = "/v1/entities/:entityId/books/:bookId";

export const SiePartitionsApi = HttpApiGroup.make("siePartitions")
  .add(
    HttpApiEndpoint.post("prepareSiePartition", `${base}/sie-partitions`, {
      params: A.Scope,
      headers: A.IdempotencyHeaders,
      payload: PreparePartition.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: Partition,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSiePartition", `${base}/sie-partitions/:id`, {
      params: A.ChangePath,
      success: Partition,
      error: accountingErrors,
    }),
  );
