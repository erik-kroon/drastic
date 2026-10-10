import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { searchSourceArchive, exportSourceArchive } from "../source-retention";
import { capabilities } from "../capabilities/index";
import * as EvidenceWork from "../evidence-work";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const SourceIntakeOperations = {
  admitSourcePreview: defineHttpOperation(
    Api.groups.sourceIntake.endpoints.admitSourcePreview,
    (token, { params, headers, payload }) =>
      EvidenceWork.admitSourcePreview(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        previewId: params.id,
        input: payload,
      }),
  ),
  approveSourcePreview: defineHttpOperation(
    Api.groups.sourceIntake.endpoints.approveSourcePreview,
    (token, { params, headers, payload }) =>
      EvidenceWork.approveSourcePreview(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        previewId: params.id,
        input: payload,
      }),
  ),
  getSourcePreview: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.getSourcePreview,
    capabilities.source_get_preview,
    ({ params }) => ({
      scope: scopeFromPath(params),
      previewId: params.id,
    }),
  ),
  getSourceRevisionHistory: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.getSourceRevisionHistory,
    capabilities.source_get_revision_history,
    ({ params }) => ({
      scope: scopeFromPath(params),
      occurrenceId: params.id,
    }),
  ),
  reparseSourceCsv: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.reparseSourceCsv,
    capabilities.source_reparse_csv,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      previewId: params.id,
      input: payload,
    }),
  ),
  previewSourceCsv: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.previewSourceCsv,
    capabilities.source_preview_csv,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      occurrenceId: params.id,
      input: payload,
    }),
  ),
  getSourcePurchaseLinks: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.getSourcePurchaseLinks,
    capabilities.source_get_purchase_links,
    ({ params }) => ({
      scope: scopeFromPath(params),
      occurrenceId: params.id,
    }),
  ),
  getSourceOccurrence: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.getSourceOccurrence,
    capabilities.source_get_occurrence,
    ({ params }) => ({
      scope: scopeFromPath(params),
      occurrenceId: params.id,
    }),
  ),
  getSourceOccurrenceMetadata: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.getSourceOccurrenceMetadata,
    capabilities.source_get_occurrence_metadata,
    ({ params }) => ({
      scope: scopeFromPath(params),
      occurrenceId: params.id,
    }),
  ),
  exportSourceArchive: defineHttpOperation(
    Api.groups.sourceIntake.endpoints.exportSourceArchive,
    (token, { params, query: filters }) => exportSourceArchive(token, params, filters),
  ),
  searchSourceArchive: defineHttpOperation(
    Api.groups.sourceIntake.endpoints.searchSourceArchive,
    (token, { params, query: filters }) => searchSourceArchive(token, params, filters),
  ),
  listSourceOccurrences: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.listSourceOccurrences,
    capabilities.source_list_occurrences,
    ({ params, query: search }) => ({
      scope: scopeFromPath(params),
      cursor: search.cursor,
    }),
  ),
  retainSource: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.retainSource,
    capabilities.source_retain,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  listSourceReviewArtifacts: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.listSourceReviewArtifacts,
    capabilities.source_list_review_artifacts,
    ({ params }) => ({ scope: scopeFromPath(params) }),
  ),
  getSourceReviewArtifact: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.getSourceReviewArtifact,
    capabilities.source_get_review_artifact,
    ({ params }) => ({
      scope: scopeFromPath(params),
      id: params.id,
    }),
  ),
  captureSourceReview: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.captureSourceReview,
    capabilities.source_capture_review,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      previewId: params.id,
      input: payload,
    }),
  ),
  recoverSourceRetention: bindHttpOperation(
    Api.groups.sourceIntake.endpoints.recoverSourceRetention,
    capabilities.source_recover_retention,
    ({ params }) => ({
      scope: scopeFromPath(params),
      key: params.key,
    }),
  ),
};
