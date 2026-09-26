import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { approveChange } from "../../../application/posting";

export const AccountingHandlers = HttpApiBuilder.group(Api, "accounting", (handlers) =>
  handlers
    .handle("bookStatus", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.book_get_status.execute(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("listBooks", () =>
      Effect.flatMap(authenticate, (token) => capabilities.book_list.execute(token, {})),
    )
    .handle("bookSetup", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.book_get_setup.execute(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("createEvidence", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.evidence_create.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getEvidence", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.evidence_get.execute(token, {
          scope: scopeFromPath(params),
          evidenceId: params.id,
        }),
      ),
    )
    .handle("prepareJournal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_prepare_journal.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getChange", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.changes_get.execute(token, {
          scope: scopeFromPath(params),
          changeSetId: params.id,
        }),
      ),
    )
    .handle("validateChange", ({ params, headers }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.changes_validate.execute(token, {
          scope: scopeFromPath(params),
          changeSetId: params.id,
          idempotencyKey: headers["idempotency-key"],
        }),
      ),
    )
    .handle("approveChange", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveChange(token, {
          scope: scopeFromPath(params),
          changeSetId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeChange", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.changes_execute.execute(token, {
          scope: scopeFromPath(params),
          changeSetId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareCorrection", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_prepare_correction.execute(token, {
          scope: scopeFromPath(params),
          voucherId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getVoucher", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_get_voucher.execute(token, {
          scope: scopeFromPath(params),
          voucherId: params.id,
        }),
      ),
    )
    .handle("listVouchers", ({ params, query: page }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_list.execute(token, {
          scope: scopeFromPath(params),
          after: page.after,
        }),
      ),
    )
    .handle("ledgerSnapshot", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.ledger_snapshot.execute(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("getReceipt", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.receipts_get.execute(token, { scope: scopeFromPath(params), key: params.key }),
      ),
    ),
);
