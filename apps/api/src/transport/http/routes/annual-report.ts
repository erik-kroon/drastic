import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  annualReportHistory,
  approveAnnualReport,
  finalizeAnnualReport,
  getAnnualReport,
  prepareAnnualReport,
  prepareReportPresentation,
  renderReportArtifact,
} from "../../../application/reports/annual-report";

export const AnnualReportHandlers = HttpApiBuilder.group(Api, "annualReport", (handlers) =>
  handlers
    .handle("prepareAnnualReport", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareAnnualReport(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveAnnualReport", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        approveAnnualReport(token, {
          scope: scopeFromPath(params),
          draftId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("finalizeAnnualReport", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        finalizeAnnualReport(token, {
          scope: scopeFromPath(params),
          draftId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareReportPresentation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareReportPresentation(token, {
          scope: scopeFromPath(params),
          finalId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("renderReportArtifact", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        renderReportArtifact(token, {
          scope: scopeFromPath(params),
          presentationId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getAnnualReport", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getAnnualReport(token, { scope: scopeFromPath(params), draftId: params.id }),
      ),
    )
    .handle("annualReportHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        annualReportHistory(token, { scope: scopeFromPath(params), fiscalYearId: params.id }),
      ),
    ),
);
