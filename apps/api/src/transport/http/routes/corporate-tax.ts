import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { capabilities } from "../../../application/capabilities";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const CorporateTaxHandlers = HttpApiBuilder.group(Api, "corporateTax", (handlers) =>
  handlers
    .handle("prepareTaxBridge", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.tax_prepare_bridge.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getTaxBridge", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.tax_get_bridge.execute(token, {
          scope: scopeFromPath(params),
          bridgeId: params.id,
        }),
      ),
    )
    .handle("listTaxBridges", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.tax_list_bridges.execute(token, {
          scope: scopeFromPath(params),
          fiscalYearId: query.fiscalYearId,
          after: query.after,
        }),
      ),
    )
    .handle("executeTaxEffect", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.tax_execute_effect.execute(token, {
          scope: scopeFromPath(params),
          bridgeId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listTaxEffects", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.tax_list_effects.execute(token, {
          scope: scopeFromPath(params),
          fiscalYearId: query.fiscalYearId,
          after: query.after,
        }),
      ),
    )
    .handle("prepareTaxDeclaration", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.tax_prepare_declaration.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getTaxDeclaration", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.tax_get_declaration.execute(token, {
          scope: scopeFromPath(params),
          declarationId: params.id,
        }),
      ),
    )
    .handle("listTaxDeclarations", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.tax_list_declarations.execute(token, {
          scope: scopeFromPath(params),
          fiscalYearId: query.fiscalYearId,
          after: query.after,
        }),
      ),
    ),
);
