import { Api } from "@open-erp/contracts/api";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { prepareVatDraft } from "../../../application/vat-returns";
import { query, scopeParameter } from "../../../db/query";

export const VatReturnsHandlers = HttpApiBuilder.group(Api, "vatReturns", (handlers) =>
  handlers
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
