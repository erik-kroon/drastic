import { Api } from "@open-erp/contracts/api";
import * as Credits from "@open-erp/contracts/supplier-credits";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const SupplierCreditHandlers = HttpApiBuilder.group(Api, "supplierCredits", (handlers) =>
  handlers
    .handle("prepareSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "prepareSupplierCredit",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Credits.SupplierCreditReview,
        ),
      ),
    )
    .handle("approveSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveSupplierCredit",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Credits.SupplierCreditApproval,
        ),
      ),
    )
    .handle("executeSupplierCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "executeSupplierCredit",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Credits.SupplierCreditReceipt,
        ),
      ),
    )
    .handle("getSupplierCreditReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getSupplierCreditReview",
          [token, scopeParameter(params), params.id],
          Credits.SupplierCreditView,
        ),
      ),
    )
    .handle("supplierCreditHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "supplierCreditHistory",
          [token, scopeParameter(params), params.id],
          Credits.SupplierCreditHistory,
        ),
      ),
    ),
);
