import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  captureSourceReview,
  getSourcePreview,
  getSourcePurchaseLinks,
  getSourceReviewArtifact,
  getSourceRevisionHistory,
  listSourceOccurrences,
  listSourceReviewArtifacts,
  previewSourceCsv,
  recoverSourceRetention,
  reparseSourceCsv,
} from "../evidence-work";
import {
  exportSourceArchive,
  getSourceOccurrence,
  getSourceOccurrenceMetadata,
  retainSource,
  searchSourceArchive,
} from "../source-retention";

export const sourceIntakeCapabilities = {
  source_retain: effectCapability(Capabilities.source_retain, retainSource),
  source_recover_retention: effectCapability(
    Capabilities.source_recover_retention,
    recoverSourceRetention,
  ),
  source_list_occurrences: effectCapability(
    Capabilities.source_list_occurrences,
    listSourceOccurrences,
  ),
  source_get_occurrence_metadata: effectCapability(
    Capabilities.source_get_occurrence_metadata,
    getSourceOccurrenceMetadata,
  ),
  source_search_archive: effectCapability(Capabilities.source_search_archive, (token, input) =>
    searchSourceArchive(token, input.scope, input.filters),
  ),
  source_export_archive: effectCapability(Capabilities.source_export_archive, (token, input) =>
    exportSourceArchive(token, input.scope, input.filters),
  ),
  source_get_occurrence: effectCapability(Capabilities.source_get_occurrence, getSourceOccurrence),
  source_get_purchase_links: effectCapability(
    Capabilities.source_get_purchase_links,
    getSourcePurchaseLinks,
  ),
  source_capture_review: effectCapability(Capabilities.source_capture_review, captureSourceReview),
  source_get_review_artifact: effectCapability(
    Capabilities.source_get_review_artifact,
    getSourceReviewArtifact,
  ),
  source_list_review_artifacts: effectCapability(
    Capabilities.source_list_review_artifacts,
    listSourceReviewArtifacts,
  ),
  source_reparse_csv: effectCapability(Capabilities.source_reparse_csv, reparseSourceCsv),
  source_get_revision_history: effectCapability(
    Capabilities.source_get_revision_history,
    getSourceRevisionHistory,
  ),
  source_preview_csv: effectCapability(Capabilities.source_preview_csv, previewSourceCsv),
  source_get_preview: effectCapability(Capabilities.source_get_preview, getSourcePreview),
};
