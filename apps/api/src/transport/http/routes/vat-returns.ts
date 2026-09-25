import { Api } from "@open-erp/contracts/api";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { prepareVatDraft } from "../../../application/vat-returns";
import { query, scopeParameter } from "../../../db/query";

export const VatReturnsHandlers = HttpApiBuilder.group(Api, "vatReturns", (handlers) =>
  handlers
    .handle("prepareVatControlReclassification", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "prepareVatControlReclassification",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Vat.VatControlReclassificationReview,
        ),
      ),
    )
    .handle("approveVatControlReclassification", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveVatControlReclassification",
          [token, scopeParameter(params), params.id, headers["idempotency-key"], JSON.stringify(payload)],
          Vat.VatControlReclassificationApproval,
        ),
      ),
    )
    .handle("executeVatControlReclassification", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "executeVatControlReclassification",
          [token, scopeParameter(params), params.id, headers["idempotency-key"], JSON.stringify(payload)],
          Vat.VatControlReclassificationEffect,
        ),
      ),
    )
    .handle("getVatControlReclassification", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getVatControlReclassification", [token, scopeParameter(params), params.id], Vat.VatControlReclassificationView),
      ),
    )
    .handle("listVatControlReclassifications", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("listVatControlReclassifications", [token, scopeParameter(params)], Vat.VatControlReclassificationList),
      ),
    )
    .handle("recoverVatControlReclassification", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "recoverVatControlReclassification",
          [token, scopeParameter(params), params.key],
          Vat.VatControlReclassificationRecovery,
        ),
      ),
    )
    .handle("withdrawVatFact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "withdrawVatFact",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          Vat.VatFactWithdrawal,
        ),
      ),
    )
    .handle("compareVatDrafts", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "compareVatDrafts",
          [token, scopeParameter(params), JSON.stringify(payload)],
          Vat.VatDraftImpactView,
        ),
      ),
    )
    .handle("reviewVatAmendment", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "reviewVatAmendment",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Vat.VatAmendment,
        ),
      ),
    )
    .handle("getVatAmendment", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getVatAmendment", [token, scopeParameter(params), params.id], Vat.VatAmendmentView),
      ),
    )
    .handle("listVatAmendments", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("listVatAmendments", [token, scopeParameter(params)], Vat.VatAmendmentList),
      ),
    )
    .handle("recordVatFact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "recordVatFact",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Vat.VatFact,
        ),
      ),
    )
    .handle("vatReturnBasis", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("vatReturnBasis", [token, scopeParameter(params)], Vat.VatBasis),
      ),
    )
    .handle("getVatFact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getVatFact", [token, scopeParameter(params), params.id], Vat.VatFactView),
      ),
    )
    .handle("prepareVatDraft", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareVatDraft(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getVatDraft", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("getVatDraft", [token, scopeParameter(params), params.id], Vat.VatDraftView),
      ),
    )
    .handle("listVatDrafts", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("listVatDrafts", [token, scopeParameter(params)], Vat.VatDraftList),
      ),
    ),
);
