import * as Accounting from "@open-erp/contracts/accounting";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "./auth";
import { capabilities } from "./capabilities";
import { query, scopeParameter } from "./database";

export const AccountingHandlers = HttpApiBuilder.group(Api, "accounting", (handlers) =>
  handlers
    .handle("bookStatus", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.book_get_status.execute(token, { scope: params }),
      ),
    )
    .handle("listBooks", () =>
      Effect.flatMap(authenticate, (token) => capabilities.book_list.execute(token, {})),
    )
    .handle("bookSetup", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.book_get_setup.execute(token, { scope: params }),
      ),
    )
    .handle("createEvidence", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.evidence_create.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getEvidence", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.evidence_get.execute(token, { scope: params, evidenceId: params.id }),
      ),
    )
    .handle("prepareJournal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_prepare_journal.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getChange", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.changes_get.execute(token, { scope: params, changeSetId: params.id }),
      ),
    )
    .handle("validateChange", ({ params, headers }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.changes_validate.execute(token, {
          scope: params,
          changeSetId: params.id,
          idempotencyKey: headers["idempotency-key"],
        }),
      ),
    )
    .handle("approveChange", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveChange",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Accounting.Approval,
        ),
      ),
    )
    .handle("executeChange", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.changes_execute.execute(token, {
          scope: params,
          changeSetId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareCorrection", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_prepare_correction.execute(token, {
          scope: params,
          voucherId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getVoucher", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_get_voucher.execute(token, { scope: params, voucherId: params.id }),
      ),
    )
    .handle("listVouchers", ({ params, query: page }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_list.execute(token, { scope: params, after: page.after }),
      ),
    )
    .handle("ledgerSnapshot", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_snapshot.execute(token, { scope: params }),
      ),
    )
    .handle("getReceipt", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.receipts_get.execute(token, { scope: params, key: params.key }),
      ),
    ),
);
