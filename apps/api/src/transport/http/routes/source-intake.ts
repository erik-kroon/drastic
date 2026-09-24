import { Api } from "@open-erp/contracts/api";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { searchSourceArchive, exportSourceArchive } from "../../../application/source-retention";
import { capabilities } from "../../../application/capabilities";
import { query, scopeParameter } from "../../../db/query";

export const SourceIntakeHandlers = HttpApiBuilder.group(Api, "sourceIntake", (handlers) =>
  handlers
    .handle("recoverSourceRetention", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "recoverSourceRetention",
          [token, scopeParameter(params), params.key],
          Intake.SourceOccurrence,
        ),
      ),
    )
    .handle("captureSourceReview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "captureSourceReview",
          [
            token,
            scopeParameter(params),
            headers["idempotency-key"],
            params.id,
            JSON.stringify(payload),
          ],
          Intake.SourceReviewCapture,
        ),
      ),
    )
    .handle("getSourceReviewArtifact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getSourceReviewArtifact",
          [token, scopeParameter(params), params.id],
          Intake.SourceReviewArtifact,
        ),
      ),
    )
    .handle("listSourceReviewArtifacts", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "listSourceReviewArtifacts",
          [token, scopeParameter(params)],
          Intake.SourceReviewArtifactList,
        ),
      ),
    )
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
    .handle("searchSourceArchive", ({ params, query: filters }) =>
      Effect.flatMap(authenticate, (token) => searchSourceArchive(token, params, filters)),
    )
    .handle("exportSourceArchive", ({ params, query: filters }) =>
      Effect.flatMap(authenticate, (token) => exportSourceArchive(token, params, filters)),
    )
    .handle("getSourceOccurrenceMetadata", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.source_get_occurrence_metadata.execute(token, {
          scope: params,
          occurrenceId: params.id,
        }),
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
    .handle("getSourcePurchaseLinks", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getSourcePurchaseLinks",
          [token, scopeParameter(params), params.id],
          Intake.SourcePurchaseLinks,
        ),
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
