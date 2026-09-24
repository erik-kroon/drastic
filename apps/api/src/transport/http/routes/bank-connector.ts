import { Api } from "@open-erp/contracts/api";
import * as Connector from "@open-erp/contracts/bank-connector";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const BankConnectorHandlers = HttpApiBuilder.group(Api, "bankConnector", (handlers) =>
  handlers
    .handle("listConnectorConsents", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "listConnectorConsents",
          [token, scopeParameter(params), search.cursor ?? ""],
          Connector.ConnectorInventory,
        ),
      ),
    )
    .handle("listConnectorBatches", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "listConnectorBatches",
          [token, scopeParameter(params), params.id, search.cursor ?? ""],
          Connector.ConnectorBatchInventory,
        ),
      ),
    )
    .handle("recoverConnectorBatch", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "recoverConnectorBatch",
          [token, scopeParameter(params), params.key],
          Connector.ConnectorBatch,
        ),
      ),
    )
    .handle("saveConnectorConsent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "saveConnectorConsent",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          Connector.ConnectorConsent,
        ),
      ),
    )
    .handle("getConnectorConsent", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getConnectorConsent",
          [token, scopeParameter(params), params.id],
          Connector.ConnectorConsentState,
        ),
      ),
    )
    .handle("revokeConnectorConsent", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "revokeConnectorConsent",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Connector.ConnectorRevocation,
        ),
      ),
    )
    .handle("ingestConnectorBatch", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "ingestConnectorBatch",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Connector.ConnectorBatch,
        ),
      ),
    )
    .handle("getConnectorBatch", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getConnectorBatch",
          [token, scopeParameter(params), params.id],
          Connector.ConnectorBatch,
        ),
      ),
    ),
);
