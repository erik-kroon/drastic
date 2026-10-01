import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import {
  getCustomerCreditArtifactState,
  getCustomerCreditArtifact,
  renderCustomerCreditArtifact,
} from "../../../application/commerce/credit-documents";
import {
  approveCustomerCredit,
  customerCreditHistory,
  executeCustomerCredit,
  getCustomerCredit,
  getCustomerCreditCapacity,
  getCustomerCreditReview,
  prepareCustomerCredit,
} from "../../../application/commerce/credit-notes";
import {
  applyCustomerCredit,
  executeCustomerReceipt,
  getCustomerCreditOrigin,
  prepareCustomerReceipt,
  refundCustomerCredit,
} from "../../../application/commerce/customer-receipts";

export const CustomerCreditHandlers = HttpApiBuilder.group(Api, "customerCreditNotes", (handlers) =>
  handlers
    .handle("prepareCustomerReceipt", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareCustomerReceipt(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCustomerReceipt", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeCustomerReceipt(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("applyCustomerCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        applyCustomerCredit(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          originId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("refundCustomerCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        refundCustomerCredit(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          originId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("getCustomerCreditOrigin", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCustomerCreditOrigin(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("getCustomerCreditArtifactState", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCustomerCreditArtifactState(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("getCustomerCreditArtifact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCustomerCreditArtifact(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("renderCustomerCreditArtifact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        renderCustomerCreditArtifact(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareCustomerCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareCustomerCredit(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveCustomerCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveCustomerCredit(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeCustomerCredit", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeCustomerCredit(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getCustomerCreditReview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCustomerCreditReview(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("getCustomerCreditCapacity", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        getCustomerCreditCapacity(token, {
          scope: scopeFromPath(params),
          id: params.id,
          accountingProfileId: query.accountingProfileId,
          accountingPeriodId: query.accountingPeriodId,
          creditDate: query.creditDate,
        }),
      ),
    )
    .handle("customerCreditHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        customerCreditHistory(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("getCustomerCreditDocument", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getCustomerCredit(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
