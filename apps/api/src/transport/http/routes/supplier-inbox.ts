import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import {
  acquireCloudIntake,
  acquireIntakeBatch,
  getIntakeDestination,
} from "../../../application/purchases/intake";
import {
  getSupplierInbox,
  listSupplierInboxes,
  recordSupplierExtraction,
  registerSupplierInbox,
  reviewSupplierInbox,
} from "../../../application/purchases/inbox";

export const SupplierInboxHandlers = HttpApiBuilder.group(Api, "supplierInbox", (handlers) =>
  handlers
    .handle("getIntakeDestination", ({ params }) =>
      Effect.flatMap(authenticate, (token) => getIntakeDestination(token, scopeFromPath(params))),
    )
    .handle("acquireIntakeBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        acquireIntakeBatch(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("acquireCloudIntake", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        acquireCloudIntake(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listSupplierInboxes", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        listSupplierInboxes(token, { scope: scopeFromPath(params), cursor: search.cursor }),
      ),
    )
    .handle("registerSupplierInbox", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        registerSupplierInbox(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getSupplierInbox", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getSupplierInbox(token, { scope: scopeFromPath(params), occurrenceId: params.id }),
      ),
    )
    .handle("recordSupplierExtraction", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        recordSupplierExtraction(token, {
          scope: scopeFromPath(params),
          occurrenceId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("reviewSupplierInbox", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        reviewSupplierInbox(token, {
          scope: scopeFromPath(params),
          occurrenceId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
