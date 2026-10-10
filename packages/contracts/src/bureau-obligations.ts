import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

export const BureauObligations = Schema.Struct({
  scope: Accounting.Scope,
  checkedAt: Schema.String,
  coverage: Schema.Literals(["complete", "partial", "unknown"]),
  coverageReason: Schema.String,
  items: Schema.Array(
    Schema.Struct({
      obligationId: Accounting.Identifier,
      creditor: Schema.String,
      currency: Schema.String,
      currencyScale: Schema.Int,
      outstandingMinor: Schema.NullOr(Accounting.MinorUnits),
      dueOn: Schema.NullOr(Accounting.AccountingDate),
      freshness: Schema.Literals(["current", "stale", "unknown"]),
      recordedAt: Schema.String,
      sources: Schema.Array(
        Schema.Struct({ evidenceId: Accounting.Identifier, sha256: Schema.String }),
      ),
      unknowns: Schema.Array(Schema.String),
    }),
  ),
});

export const BureauObligationsApi = HttpApiGroup.make("bureauObligations").add(
  HttpApiEndpoint.get(
    "listBureauObligations",
    "/v1/entities/:entityId/books/:bookId/bureau-obligations",
    {
      params: Accounting.Scope,
      success: BureauObligations,
      error: accountingErrors,
    },
  ),
);

export const BureauObligationsCapabilities = {
  bureau_list_obligations: {
    description:
      "Read stored supplier obligations by canonical invoice ID, creditor, residual, due date and source freshness. Coverage is partial or unknown, never inferred complete; this does not include unregistered debts.",
    input: Schema.Struct({ scope: Accounting.Scope }),
    output: BureauObligations,
    readOnly: true,
  },
};
