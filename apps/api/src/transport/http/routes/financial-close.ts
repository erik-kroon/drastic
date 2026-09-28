import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  advanceYearClose,
  approveFinalProposal,
  executeFinalClose,
  financialCloseHistory,
  getFinancialCloseCertificate,
  getFinancialOpeningSet,
  getFinancialYearStatus,
  prepareYearClose,
  prepareYearReopen,
} from "../../../application/closing/financial-close";

export const FinancialCloseHandlers = HttpApiBuilder.group(Api, "financialClose", (handlers) =>
  handlers
    .handle("prepareYearClose", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareYearClose(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("advanceYearClose", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        advanceYearClose(token, {
          scope: scopeFromPath(params),
          preparationId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveFinalProposal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveFinalProposal(token, {
          scope: scopeFromPath(params),
          proposalId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeFinalClose", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        executeFinalClose(token, {
          scope: scopeFromPath(params),
          proposalId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareYearReopen", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareYearReopen(token, {
          scope: scopeFromPath(params),
          fiscalYearId: params.fiscalYearId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getFinancialYearStatus", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getFinancialYearStatus(token, {
          scope: scopeFromPath(params),
          fiscalYearId: params.id,
        }),
      ),
    )
    .handle("getFinancialCloseCertificate", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getFinancialCloseCertificate(token, {
          scope: scopeFromPath(params),
          certificateId: params.id,
        }),
      ),
    )
    .handle("getFinancialOpeningSet", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getFinancialOpeningSet(token, {
          scope: scopeFromPath(params),
          openingSetId: params.id,
        }),
      ),
    )
    .handle("financialCloseHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        financialCloseHistory(token, {
          scope: scopeFromPath(params),
          fiscalYearId: params.id,
        }),
      ),
    ),
);
