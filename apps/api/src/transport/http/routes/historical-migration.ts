import { Api } from "@open-erp/contracts/api";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const HistoricalMigrationHandlers = HttpApiBuilder.group(
  Api,
  "historicalMigration",
  (handlers) =>
    handlers
      .handle("admitHistoricalItems", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "admitHistoricalItems",
            [
              token,
              scopeParameter(params),
              headers["idempotency-key"],
              params.id,
              JSON.stringify(payload),
            ],
            Historical.ItemAdmission,
          ),
        ),
      )
      .handle("getHistoricalItems", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "getHistoricalItems",
            [token, scopeParameter(params), params.id],
            Historical.ItemAdmission,
          ),
        ),
      )
      .handle("selectHistoricalBasis", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "selectHistoricalBasis",
            [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
            Historical.Basis,
          ),
        ),
      )
      .handle("getHistoricalBasis", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query("getHistoricalBasis", [token, scopeParameter(params), params.id], Historical.Basis),
        ),
      )
      .handle("postHistoricalOpening", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "postHistoricalOpening",
            [
              token,
              scopeParameter(params),
              headers["idempotency-key"],
              params.id,
              payload.planDigest,
              payload.approvalId,
            ],
            Historical.Basis,
          ),
        ),
      )
      .handle("startSieFinancialRun", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "startSieFinancialRun",
            [
              token,
              scopeParameter(params),
              headers["idempotency-key"],
              params.id,
              payload.fiscalYearId,
              payload.planDigest,
            ],
            Historical.RunStart,
          ),
        ),
      )
      .handle("getSieFinancialRun", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          query("getSieFinancialRun", [token, scopeParameter(params), params.id], Historical.Run),
        ),
      )
      .handle("advanceSieFinancialRun", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "advanceSieFinancialRun",
            [
              token,
              scopeParameter(params),
              headers["idempotency-key"],
              params.id,
              JSON.stringify(payload),
            ],
            Historical.Chunk,
          ),
        ),
      )
      .handle("reclaimSieFinancialRun", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          query(
            "reclaimSieFinancialRun",
            [token, scopeParameter(params), headers["idempotency-key"], params.id, payload.action],
            Historical.Fence,
          ),
        ),
      ),
);
