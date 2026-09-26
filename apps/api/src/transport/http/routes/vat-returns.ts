import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { prepareVatDraft } from "../../../application/vat-returns";
import * as Vat from "../../../application/vat/returns";

export const VatReturnsHandlers = HttpApiBuilder.group(Api, "vatReturns", (handlers) =>
  handlers
    .handle("prepareVatControlReclassification", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.prepareReclassification(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveVatControlReclassification", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.approveReclassification(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeVatControlReclassification", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.executeReclassification(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getVatControlReclassification", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.getReclassification(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listVatControlReclassifications", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.listReclassifications(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("recoverVatControlReclassification", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.recoverReclassification(token, { scope: scopeFromPath(params), key: params.key }),
      ),
    )
    .handle("withdrawVatFact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.withdrawFact(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("compareVatDrafts", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.compareDrafts(token, { scope: scopeFromPath(params), input: payload }),
      ),
    )
    .handle("reviewVatAmendment", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.reviewAmendment(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getVatAmendment", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.getAmendment(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listVatAmendments", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.listAmendments(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("recordVatFact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.recordFact(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("vatReturnBasis", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.returnBasis(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("getVatFact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.getFact(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("prepareVatDraft", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareVatDraft(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getVatDraft", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.getDraft(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listVatDrafts", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Vat.listDrafts(token, { scope: scopeFromPath(params) }),
      ),
    ),
);
