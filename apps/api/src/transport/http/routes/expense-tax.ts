import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as ExpenseTax from "../../../application/vat/expense-tax";

export const ExpenseTaxHandlers = HttpApiBuilder.group(Api, "expenseTax", (handlers) =>
  handlers
    .handle("withdrawExpenseTaxSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        ExpenseTax.withdrawSource(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("recordExpenseTaxSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        ExpenseTax.recordSource(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("expenseTaxInventory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        ExpenseTax.inventory(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("getExpenseTaxSource", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        ExpenseTax.getSource(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("reviewExpenseTaxSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        ExpenseTax.reviewSource(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareExpenseTaxSnapshot", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        ExpenseTax.prepareSnapshot(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getExpenseTaxSnapshot", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        ExpenseTax.getSnapshot(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listExpenseTaxSnapshots", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        ExpenseTax.listSnapshots(token, { scope: scopeFromPath(params), ...search }),
      ),
    ),
);
