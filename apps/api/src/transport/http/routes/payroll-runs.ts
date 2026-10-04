import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Runs from "../../../application/payroll/runs";
import * as Payslips from "../../../application/payroll/payslips";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const PayrollRunHandlers = HttpApiBuilder.group(Api, "payrollRun", (handlers) =>
  handlers
    .handle("preparePayrollRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Runs.prepareRun(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approvePayrollRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Runs.approveRun(token, {
          scope: scopeFromPath(params),
          runId: params.runId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executePayrollRun", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Runs.executeRun(token, {
          scope: scopeFromPath(params),
          runId: params.runId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getPayrollRun", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Runs.getRun(token, { scope: scopeFromPath(params), runId: params.runId }),
      ),
    )
    .handle("listPayrollRuns", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Runs.listRuns(token, { scope: scopeFromPath(params), after: query.after }),
      ),
    )
    .handle("getPayrollPayslip", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Payslips.getPayslip(token, { scope: scopeFromPath(params), documentId: params.documentId }),
      ),
    )
    .handle("getPayrollPayslipArtifact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Payslips.getPayslipArtifact(token, {
          scope: scopeFromPath(params),
          documentId: params.documentId,
        }),
      ),
    )
    .handle("renderPayrollPayslip", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Payslips.renderPayslip(token, {
          scope: scopeFromPath(params),
          documentId: params.documentId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
