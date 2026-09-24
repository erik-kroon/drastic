import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

const Code = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/));
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));
const Revision = Schema.Finite.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThan(100000),
);
const SavedRevision = Revision.check(Schema.isGreaterThanOrEqualTo(1));
const Fields = Schema.Struct({
  code: Code,
  name: Name,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  archived: Schema.Boolean,
});
const Item = Schema.Struct({ ...Fields.fields, revision: SavedRevision });
const RevisionItem = Schema.Struct({
  revision: SavedRevision,
  name: Name,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  archived: Schema.Boolean,
});
export const SaveDimension = Schema.Struct({ expectedRevision: Revision, ...Fields.fields });
export const SaveDimensionValue = Schema.Struct({
  dimensionCode: Code,
  expectedRevision: Revision,
  ...Fields.fields,
});
export const DimensionValue = Schema.Struct({
  ...Item.fields,
  revisions: Schema.Array(RevisionItem),
});
export const Dimension = Schema.Struct({
  ...Item.fields,
  values: Schema.Array(DimensionValue),
  revisions: Schema.Array(RevisionItem),
});
export const DimensionList = Schema.Struct({
  scope: Accounting.Scope,
  dimensions: Schema.Array(Dimension),
});
export const DimensionSaved = Schema.Struct({ scope: Accounting.Scope, ...Item.fields });
export const DimensionValueSaved = Schema.Struct({
  scope: Accounting.Scope,
  dimensionCode: Code,
  ...Item.fields,
});
const base = "/v1/entities/:entityId/books/:bookId/dimensions";
export const DimensionsApi = HttpApiGroup.make("dimensions")
  .add(
    HttpApiEndpoint.get("listDimensions", base, {
      params: Accounting.Scope,
      success: DimensionList,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveDimension", base, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: SaveDimension,
      success: DimensionSaved,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveDimensionValue", `${base}/values`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: SaveDimensionValue,
      success: DimensionValueSaved,
      error: accountingErrors,
    }),
  );
