import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/payroll/employee-claims";
import * as Payments from "../../../application/payroll/employee-claim-payments";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const EmployeeClaimHandlers = HttpApiBuilder.group(Api, "employeeClaims", (handlers) =>
  handlers
    .handle("submitEmployeeClaim", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.submitEmployeeClaim(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listEmployeeClaims", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.listEmployeeClaims(token, { scope: scopeFromPath(params), after: query.after }),
      ),
    )
    .handle("getEmployeeClaim", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.getEmployeeClaim(token, { scope: scopeFromPath(params), claimId: params.claimId }),
      ),
    )
    .handle("reviseEmployeeClaim", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.reviseEmployeeClaim(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          claimId: params.claimId,
        }),
      ),
    )
    .handle("reviewEmployeeClaim", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.reviewEmployeeClaim(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          claimId: params.claimId,
        }),
      ),
    )
    .handle("approveEmployeeClaim", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.approveEmployeeClaim(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          reviewId: params.reviewId,
        }),
      ),
    )
    .handle("requestClaimCompletion", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.requestClaimCompletion(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          claimId: params.claimId,
        }),
      ),
    )
    .handle("proposeEmployeePayee", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Payments.proposeEmployeePayee(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("verifyEmployeePayee", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Payments.verifyEmployeePayee(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          id: params.id,
        }),
      ),
    )
    .handle("prepareClaimPaymentFile", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Payments.prepareClaimPaymentFile(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          instructionId: params.instructionId,
        }),
      ),
    )
    .handle("approveClaimPaymentFile", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Payments.approveClaimPaymentFile(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          id: params.id,
        }),
      ),
    )
    .handle("prepareClaimSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Payments.prepareClaimSettlement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          instructionId: params.instructionId,
        }),
      ),
    )
    .handle("approveClaimSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Payments.approveClaimSettlement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
          id: params.id,
        }),
      ),
    ),
);
