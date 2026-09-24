import { Api } from "@open-erp/contracts/api";
import * as Issuance from "@open-erp/contracts/supplier-acceptance";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const SupplierAcceptanceHandlers = HttpApiBuilder.group(
  Api,
  "supplierAcceptance",
  (handlers) =>
    handlers
      .handle("prepareSupplierAcceptance", ({ params, headers, payload }) =>
        Effect.gen(function* () {
          const token = yield* authenticate;
          return yield* query(
            "prepareSupplierAcceptance",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Issuance.SupplierAcceptanceReview,
          );
        }),
      )
      .handle("approveSupplierAcceptance", ({ params, headers, payload }) =>
        Effect.gen(function* () {
          const token = yield* authenticate;
          return yield* query(
            "approveSupplierAcceptance",
            [
              token,
              scopeParameter(params),
              params.id,
              headers["idempotency-key"],
              JSON.stringify(payload),
            ],
            Issuance.SupplierAcceptanceApproval,
          );
        }),
      )
      .handle("executeSupplierAcceptance", ({ params, headers, payload }) =>
        Effect.gen(function* () {
          const token = yield* authenticate;
          return yield* query(
            "executeSupplierAcceptance",
            [
              token,
              scopeParameter(params),
              params.id,
              headers["idempotency-key"],
              JSON.stringify(payload),
            ],
            Issuance.SupplierAcceptanceReceipt,
          );
        }),
      )
      .handle("getSupplierAcceptanceReview", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getSupplierAcceptanceReview",
            [token, scopeParameter(params), params.id],
            Issuance.SupplierAcceptanceView,
          ),
        ),
      )
      .handle("supplierAcceptanceHistory", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "supplierAcceptanceHistory",
            [token, scopeParameter(params), params.id],
            Issuance.SupplierAcceptanceHistory,
          ),
        ),
      ),
);
