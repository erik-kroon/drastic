import { Api } from "@open-erp/contracts/api";
import * as Tax from "@open-erp/contracts/tax-account";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const TaxAccountHandlers = HttpApiBuilder.group(Api, "taxAccount", (handlers) =>
  handlers
    .handle("previewTaxAccountMatch", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "previewTaxAccountMatch",
          [token, scopeParameter(params), JSON.stringify(payload)],
          Tax.TaxAccountMatchBasis,
        ),
      ),
    )
    .handle("matchTaxAccountEvent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "matchTaxAccountEvent",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Tax.TaxAccountMatch,
        ),
      ),
    )
    .handle("unmatchTaxAccountEvent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "unmatchTaxAccountEvent",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Tax.TaxAccountUnmatch,
        ),
      ),
    )
    .handle("getTaxAccountMatch", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getTaxAccountMatch",
          [token, scopeParameter(params), params.id],
          Tax.TaxAccountMatchDetail,
        ),
      ),
    )
    .handle("listTaxAccountMatches", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("listTaxAccountMatches", [token, scopeParameter(params)], Tax.TaxAccountMatchList),
      ),
    )
    .handle("recordTaxAccountStatement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "recordTaxAccountStatement",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Tax.TaxAccountStatement,
        ),
      ),
    )
    .handle("getTaxAccountStatement", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getTaxAccountStatement",
          [token, scopeParameter(params), params.id],
          Tax.TaxAccountStatement,
        ),
      ),
    )
    .handle("listTaxAccountStatements", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "listTaxAccountStatements",
          [token, scopeParameter(params)],
          Tax.TaxAccountStatementList,
        ),
      ),
    )
    .handle("createTaxAccountControl", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "createTaxAccountControl",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Tax.TaxAccountControl,
        ),
      ),
    )
    .handle("getTaxAccountControl", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getTaxAccountControl",
          [token, scopeParameter(params), params.id],
          Tax.TaxAccountControlView,
        ),
      ),
    )
    .handle("listTaxAccountControls", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query("listTaxAccountControls", [token, scopeParameter(params)], Tax.TaxAccountControlList),
      ),
    ),
);
