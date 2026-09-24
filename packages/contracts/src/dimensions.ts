import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

const Code = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/));
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));
const Item = Schema.Struct({
  code: Code,
  name: Name,
  effectiveFrom: Accounting.AccountingDate,
  effectiveTo: Schema.NullOr(Accounting.AccountingDate),
  archived: Schema.Boolean,
});
export const SaveDimension = Item;
export const SaveDimensionValue = Schema.Struct({ dimensionCode: Code, ...Item.fields });
export const DimensionValue = Item;
export const Dimension = Schema.Struct({ ...Item.fields, values: Schema.Array(DimensionValue) });
export const DimensionList = Schema.Struct({ scope: Accounting.Scope, dimensions: Schema.Array(Dimension) });
export const DimensionSaved = Schema.Struct({ scope: Accounting.Scope, ...Item.fields });
export const DimensionValueSaved = Schema.Struct({ scope: Accounting.Scope, dimensionCode: Code, ...Item.fields });
const base = "/v1/entities/:entityId/books/:bookId/dimensions";
export const DimensionsApi = HttpApiGroup.make("dimensions")
  .add(HttpApiEndpoint.get("listDimensions", base, {
    params: Accounting.ChangePath, success: DimensionList, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.post("saveDimension", base, {
    params: Accounting.ChangePath, headers: Accounting.IdempotencyHeaders,
    payload: SaveDimension, success: DimensionSaved, error: accountingErrors,
  }))
  .add(HttpApiEndpoint.post("saveDimensionValue", `${base}/values`, {
    params: Accounting.ChangePath, headers: Accounting.IdempotencyHeaders,
    payload: SaveDimensionValue, success: DimensionValueSaved, error: accountingErrors,
  }));
