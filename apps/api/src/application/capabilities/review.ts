import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getReviewPack, listReviewPacks, prepareReviewPack, reviewPackArtifact, reviewPackRows } from "../accountant-review";

export const reviewCapabilities = {
  accountant_review_prepare: effectCapability(
    Capabilities.accountant_review_prepare,
    prepareReviewPack,
  ),
  accountant_review_list: effectCapability(Capabilities.accountant_review_list, listReviewPacks),
  accountant_review_get: effectCapability(Capabilities.accountant_review_get, getReviewPack),
  accountant_review_rows: effectCapability(Capabilities.accountant_review_rows, reviewPackRows),
  accountant_review_artifact: effectCapability(
    Capabilities.accountant_review_artifact,
    reviewPackArtifact,
  ),
};
