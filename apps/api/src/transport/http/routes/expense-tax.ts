import { Api } from "@open-erp/contracts/api";
import * as Tax from "@open-erp/contracts/expense-tax";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const ExpenseTaxHandlers = HttpApiBuilder.group(Api, "expenseTax", (handlers) =>
  handlers
    .handle("recordExpenseTaxSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.expense_tax_record_source.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("expenseTaxInventory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.expense_tax_inventory.execute(token, { scope: params }),
      ),
    )
    .handle("getExpenseTaxSource", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.expense_tax_get_source.execute(token, { scope: params, sourceId: params.id }),
      ),
    )
    .handle("reviewExpenseTaxSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "reviewExpenseTaxSource",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Tax.TaxReview,
        ),
      ),
    )
    .handle("prepareExpenseTaxSnapshot", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.expense_tax_prepare_snapshot.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getExpenseTaxSnapshot", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.expense_tax_get_snapshot.execute(token, {
          scope: params,
          snapshotId: params.id,
        }),
      ),
    )
    .handle("listExpenseTaxSnapshots", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.expense_tax_list_snapshots.execute(token, { scope: params, ...search }),
      ),
    ),
);
