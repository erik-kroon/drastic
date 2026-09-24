import { Api } from "@open-erp/contracts/api";
import * as Payments from "@open-erp/contracts/supplier-payment-batches";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const SupplierPaymentBatchHandlers = HttpApiBuilder.group(
  Api,
  "supplierPaymentBatches",
  (handlers) =>
    handlers
      .handle("prepareSupplierPaymentBatch", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "prepareSupplierPaymentBatch",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Payments.SupplierPaymentPreview,
          ),
        ),
      )
      .handle("exportSupplierPaymentBatch", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "exportSupplierPaymentBatch",
            [
              token,
              scopeParameter(params),
              params.id,
              headers["idempotency-key"],
              JSON.stringify(payload),
            ],
            Payments.SupplierPaymentExport,
          ),
        ),
      )
      .handle("listSupplierPaymentEligibility", ({ params, query: search }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "listSupplierPaymentEligibility",
            [token, scopeParameter(params), search.after ?? ""],
            Payments.PaymentEligibility,
          ),
        ),
      )
      .handle("proposeSupplierPayee", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "proposeSupplierPayee",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Payments.PayeeProposal,
          ),
        ),
      )
      .handle("getSupplierPayee", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getSupplierPayee",
            [token, scopeParameter(params), params.id],
            Payments.PayeeReview,
          ),
        ),
      )
      .handle("verifySupplierPayee", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "verifySupplierPayee",
            [
              token,
              scopeParameter(params),
              params.id,
              headers["idempotency-key"],
              JSON.stringify(payload),
            ],
            Payments.PayeeVerification,
          ),
        ),
      )
      .handle("reportSupplierPaymentOutcome", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "reportSupplierPaymentOutcome",
            [
              token,
              scopeParameter(params),
              params.id,
              headers["idempotency-key"],
              JSON.stringify(payload),
            ],
            Payments.PaymentOutcome,
          ),
        ),
      )
      .handle("getSupplierPaymentBatch", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getSupplierPaymentBatch",
            [token, scopeParameter(params), params.id],
            Payments.SupplierPaymentBatchView,
          ),
        ),
      ),
);
