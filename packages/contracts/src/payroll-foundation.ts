import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

const Identity = Accounting.Identifier;
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Facts = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));
const PayrollDate = Accounting.AccountingDate.check(
  Schema.makeFilter((value) => {
    const time = Date.parse(value);
    return (
      (value >= "0001-01-01" &&
        Number.isFinite(time) &&
        new Date(time).toISOString().slice(0, 10) === value) ||
      "Enter a valid calendar date."
    );
  }),
);
const Employment = Schema.Struct({
  personRef: Text,
  jurisdiction: Text,
  residency: Text,
  payTerms: Facts,
  workSchedule: Facts,
  taxFacts: Facts,
});
const Work = Schema.Struct({
  periodStart: PayrollDate,
  periodEnd: PayrollDate,
  inputs: Schema.Array(Schema.Unknown).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
}).check(
  Schema.makeFilter((value) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (value.periodStart > value.periodEnd) {
      issues.push({
        path: ["periodEnd"],
        issue: "The work-input period must end on or after its start date.",
      });
    }
    return issues;
  }),
);
const Opening = Schema.Struct({
  asOf: PayrollDate,
  balanceMinor: Accounting.SignedMinorUnits,
  obligation: Text,
});
const RevisionInput = Schema.Struct({
  employeeId: Identity,
  effectiveOn: Accounting.AccountingDate,
  supersedes: Schema.NullOr(Identity),
  evidenceId: Identity,
});
export const CapturePayrollRevision = Schema.Union([
  Schema.Struct({ ...RevisionInput.fields, kind: Schema.Literal("employment"), body: Employment }),
  Schema.Struct({ ...RevisionInput.fields, kind: Schema.Literal("work"), body: Work }),
  Schema.Struct({ ...RevisionInput.fields, kind: Schema.Literal("opening"), body: Opening }),
]);
export const PayrollRevision = Schema.Struct({
  id: Identity,
  scope: Accounting.Scope,
  employeeId: Identity,
  kind: Schema.Literals(["employment", "work", "opening"]),
  effectiveOn: Accounting.AccountingDate,
  supersedes: Schema.NullOr(Identity),
  evidenceId: Identity,
  body: Schema.Unknown,
  createdBy: Identity,
});
export const PayrollHistoryItem = Schema.Struct({
  ...PayrollRevision.fields,
  scope: Schema.optional(Accounting.Scope),
  createdAt: Schema.String,
  isCurrent: Schema.Boolean,
});
export const PayrollHistory = Schema.Struct({
  scope: Accounting.Scope,
  employeeId: Identity,
  items: Schema.Array(PayrollHistoryItem),
});
export const PayrollEmployee = Schema.Struct({
  scope: Accounting.Scope,
  employeeId: Identity,
  createdAt: Schema.String,
});
export const PayrollEmployeePage = Schema.Struct({
  scope: Accounting.Scope,
  items: Schema.Array(PayrollEmployee).check(Schema.isMaxLength(50)),
  nextCursor: Schema.NullOr(Identity),
});
export const PayrollAccess = Schema.Struct({ actorId: Identity, allowed: Schema.Boolean });
export const PayrollAccessResult = Schema.Struct({
  scope: Accounting.Scope,
  ...PayrollAccess.fields,
});
const root = "/v1/entities/:entityId/books/:bookId/payroll";
export const PayrollFoundationApi = HttpApiGroup.make("payrollFoundation")
  .add(
    HttpApiEndpoint.get("listPayrollEmployees", `${root}/employees`, {
      params: Accounting.Scope,
      query: Schema.Struct({ after: Schema.optional(Identity) }),
      success: PayrollEmployeePage,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("setPayrollAccess", `${root}/access`, {
      params: Accounting.Scope,
      payload: PayrollAccess,
      success: PayrollAccessResult,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("capturePayrollRevision", `${root}/revisions`, {
      params: Accounting.Scope,
      headers: Accounting.IdempotencyHeaders,
      payload: CapturePayrollRevision.annotate({ parseOptions: { onExcessProperty: "error" } }),
      success: PayrollRevision,
      error: accountingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listPayrollRevisions", `${root}/employees/:id/revisions`, {
      params: Accounting.ChangePath,
      success: PayrollHistory,
      error: accountingErrors,
    }),
  );
