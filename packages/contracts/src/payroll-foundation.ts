import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";

const Identity = Accounting.Identifier;
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Facts = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));
const Employment = Schema.Struct({ personRef: Text, jurisdiction: Text, residency: Text, payTerms: Facts, workSchedule: Facts, taxFacts: Facts });
const Work = Schema.Struct({ periodStart: Accounting.AccountingDate, periodEnd: Accounting.AccountingDate, inputs: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(200)) });
const Opening = Schema.Struct({ asOf: Accounting.AccountingDate, balanceMinor: Schema.String.check(Schema.isPattern(/^-?[0-9]{1,18}$/)), obligation: Text });
export const CapturePayrollRevision = Schema.Union([
  Schema.Struct({ employeeId: Identity, kind: Schema.Literal("employment"), effectiveOn: Accounting.AccountingDate, supersedes: Schema.NullOr(Identity), evidenceId: Text, body: Employment }),
  Schema.Struct({ employeeId: Identity, kind: Schema.Literal("work"), effectiveOn: Accounting.AccountingDate, supersedes: Schema.NullOr(Identity), evidenceId: Text, body: Work }),
  Schema.Struct({ employeeId: Identity, kind: Schema.Literal("opening"), effectiveOn: Accounting.AccountingDate, supersedes: Schema.NullOr(Identity), evidenceId: Text, body: Opening }),
]);
export const PayrollRevision = Schema.Struct({ id: Identity, scope: Accounting.Scope, employeeId: Identity,
  kind: Schema.Literals(["employment", "work", "opening"]), effectiveOn: Accounting.AccountingDate,
  supersedes: Schema.NullOr(Identity), evidenceId: Text, body: Schema.Unknown, createdBy: Identity });
export const PayrollHistory = Schema.Struct({ scope: Accounting.Scope, employeeId: Identity,
  items: Schema.Array(Schema.Struct({ ...PayrollRevision.fields, scope: Schema.optional(Accounting.Scope), createdAt: Schema.String })) });
export const PayrollAccess = Schema.Struct({ actorId: Identity, allowed: Schema.Boolean });
export const PayrollAccessResult = Schema.Struct({ scope: Accounting.Scope, ...PayrollAccess.fields });
const root = "/v1/entities/:entityId/books/:bookId/payroll";
export const PayrollFoundationApi = HttpApiGroup.make("payrollFoundation")
  .add(HttpApiEndpoint.post("setPayrollAccess", `${root}/access`, { params: Accounting.Scope,
    payload: PayrollAccess, success: PayrollAccessResult, error: accountingErrors }))
  .add(HttpApiEndpoint.post("capturePayrollRevision", `${root}/revisions`, { params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders, payload: CapturePayrollRevision, success: PayrollRevision, error: accountingErrors }))
  .add(HttpApiEndpoint.get("listPayrollRevisions", `${root}/employees/:id/revisions`, { params: Accounting.ChangePath,
    success: PayrollHistory, error: accountingErrors }));
