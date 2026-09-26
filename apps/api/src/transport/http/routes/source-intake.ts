import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { searchSourceArchive, exportSourceArchive } from "../../../application/source-retention";
import { capabilities } from "../../../application/capabilities";
import * as EvidenceWork from "../../../application/evidence-work";

export const SourceIntakeHandlers = HttpApiBuilder.group(Api, "sourceIntake", (handlers) =>
  handlers
    .handle("recoverSourceRetention", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.recoverSourceRetention(token, {
          scope: scopeFromPath(params),
          key: params.key,
        }),
      ),
    )
    .handle("captureSourceReview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.captureSourceReview(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          previewId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("getSourceReviewArtifact", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.getSourceReviewArtifact(token, {
          scope: scopeFromPath(params),
          id: params.id,
        }),
      ),
    )
    .handle("listSourceReviewArtifacts", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.listSourceReviewArtifacts(token, { scope: scopeFromPath(params) }),
      ),
    )
    .handle("retainSource", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.source_retain.execute(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listSourceOccurrences", ({ params, query: search }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.listSourceOccurrences(token, {
          scope: scopeFromPath(params),
          cursor: search.cursor,
        }),
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
          scope: scopeFromPath(params),
          occurrenceId: params.id,
        }),
      ),
    )
    .handle("getSourceOccurrence", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.source_get_occurrence.execute(token, {
          scope: scopeFromPath(params),
          occurrenceId: params.id,
        }),
      ),
    )
    .handle("getSourcePurchaseLinks", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.getSourcePurchaseLinks(token, {
          scope: scopeFromPath(params),
          occurrenceId: params.id,
        }),
      ),
    )
    .handle("previewSourceCsv", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.previewSourceCsv(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          occurrenceId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("reparseSourceCsv", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.reparseSourceCsv(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          previewId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("getSourceRevisionHistory", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.getSourceRevisionHistory(token, {
          scope: scopeFromPath(params),
          occurrenceId: params.id,
        }),
      ),
    )
    .handle("getSourcePreview", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.getSourcePreview(token, {
          scope: scopeFromPath(params),
          previewId: params.id,
        }),
      ),
    )
    .handle("approveSourcePreview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.approveSourcePreview(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          previewId: params.id,
          input: payload,
        }),
      ),
    )
    .handle("admitSourcePreview", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        EvidenceWork.admitSourcePreview(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          previewId: params.id,
          input: payload,
        }),
      ),
    ),
);
