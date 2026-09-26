import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Tax from "../../../application/vat/tax-account";

export const TaxAccountHandlers = HttpApiBuilder.group(Api, "taxAccount", (handlers) =>
  handlers
    .handle("listUnclassifiedTaxAccountEvents", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.listUnclassifiedEvents(token, {
          scope: scopeFromPath(params),
          accountId: search.accountId,
          after: search.after,
        }),
      ),
    )
    .handle("resolveTaxAccountEventClassification", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.resolveEventClassification(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getTaxAccountEventClassification", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.getEventClassification(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("previewTaxAccountMatch", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.previewMatch(token, { scope: scopeFromPath(params), input: payload }),
      ),
    )
    .handle("matchTaxAccountEvent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.matchEvent(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("unmatchTaxAccountEvent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.unmatchEvent(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          id: params.id,
          input: payload,
        }),
      ),
    )
    .handle("getTaxAccountMatch", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.getMatch(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listTaxAccountMatches", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.listMatches(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("recordTaxAccountStatement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.recordStatement(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getTaxAccountStatement", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.getStatement(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listTaxAccountStatements", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.listStatements(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("createTaxAccountControl", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.createControl(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getTaxAccountControl", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.getControl(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("listTaxAccountControls", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Tax.listControls(token, { scope: scopeFromPath(params) }),
      ),
    ),
);
