import { Api } from "@open-erp/contracts/api";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const SourceIntakeHandlers = HttpApiBuilder.group(Api, "sourceIntake", (handlers) =>
  handlers
    .handle("retainSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.source_retain.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listSourceOccurrences", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "listSourceOccurrences",
          [token, scopeParameter(params), search.cursor ?? ""],
          Intake.SourceInventory,
        ),
      ),
    )
    .handle("getSourceOccurrence", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.source_get_occurrence.execute(token, {
          scope: params,
          occurrenceId: params.id,
        }),
      ),
    )
    .handle("previewSourceCsv", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "previewSourceCsv",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Intake.SourcePreview,
        ),
      ),
    )
    .handle("reparseSourceCsv", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "reparseSourceCsv",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Intake.SourceReparse,
        ),
      ),
    )
    .handle("getSourceRevisionHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getSourceRevisionHistory",
          [token, scopeParameter(params), params.id],
          Intake.SourceRevisionHistory,
        ),
      ),
    )
    .handle("getSourcePreview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getSourcePreview",
          [token, scopeParameter(params), params.id],
          Intake.SourcePreviewView,
        ),
      ),
    )
    .handle("approveSourcePreview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveSourcePreview",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Intake.SourceApproval,
        ),
      ),
    )
    .handle("admitSourcePreview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "admitSourcePreview",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Intake.SourceAdmission,
        ),
      ),
    ),
);
