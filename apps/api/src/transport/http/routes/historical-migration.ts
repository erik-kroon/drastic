import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Historical from "../../../application/sie/historical";

export const HistoricalMigrationHandlers = HttpApiBuilder.group(
  Api,
  "historicalMigration",
  (handlers) =>
    handlers
      .handle("refreshHistoricalOpening", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.refreshOpening(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            id: params.id,
            input: payload,
          }),
        ),
      )
      .handle("compareSieClosing", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.compareSieClosing(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("prepareHistoricalOpening", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.prepareOpening(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getSieFinancialWorkspace", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.getFinancialWorkspace(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("prepareSieFinancialVoucher", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.prepareFinancialVoucher(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            id: params.id,
            input: payload,
          }),
        ),
      )
      .handle("admitHistoricalItems", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.admitItems(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            id: params.id,
            input: payload,
          }),
        ),
      )
      .handle("getPlanHistoricalItems", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.getPlanItems(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("getHistoricalItems", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.getItems(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("listHistoricalBases", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.listBases(token, { scope: scopeFromPath(params) }),
        ),
      )
      .handle("selectHistoricalBasis", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.selectBasis(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            input: payload,
          }),
        ),
      )
      .handle("getHistoricalBasis", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.getBasis(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("postHistoricalOpening", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.postOpening(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            id: params.id,
            planDigest: payload.planDigest,
            approvalId: payload.approvalId,
          }),
        ),
      )
      .handle("startSieFinancialRun", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.startFinancialRun(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            id: params.id,
            fiscalYearId: payload.fiscalYearId,
            planDigest: payload.planDigest,
          }),
        ),
      )
      .handle("getSieFinancialRun", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.getFinancialRun(token, { scope: scopeFromPath(params), id: params.id }),
        ),
      )
      .handle("advanceSieFinancialRun", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.advanceFinancialRun(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            id: params.id,
            input: payload,
          }),
        ),
      )
      .handle("reclaimSieFinancialRun", ({ params, headers, payload }) =>
        Effect.flatMap(authenticate, (token) =>
          Historical.reclaimFinancialRun(token, {
            scope: scopeFromPath(params),
            idempotencyKey: headers["idempotency-key"],
            id: params.id,
            action: payload.action,
          }),
        ),
      ),
);
