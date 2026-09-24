import { Api } from "@open-erp/contracts/api";
import * as Payroll from "@open-erp/contracts/payroll-foundation";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const PayrollFoundationHandlers = HttpApiBuilder.group(Api, "payrollFoundation", handlers => handlers
  .handle("setPayrollAccess", ({ params, payload }) => Effect.flatMap(authenticate, token =>
    query("setPayrollAccess", [token, scopeParameter(params), payload.actorId, String(payload.allowed)], Payroll.PayrollAccessResult)))
  .handle("capturePayrollRevision", ({ params, headers, payload }) => Effect.flatMap(authenticate, token =>
    query("capturePayrollRevision", [token, scopeParameter(params), headers["idempotency-key"], payload.employeeId,
      payload.kind, payload.effectiveOn, payload.supersedes ?? "", payload.evidenceId, JSON.stringify(payload.body)], Payroll.PayrollRevision)))
  .handle("listPayrollRevisions", ({ params }) => Effect.flatMap(authenticate, token =>
    query("listPayrollRevisions", [token, scopeParameter(params), params.id], Payroll.PayrollHistory))));
