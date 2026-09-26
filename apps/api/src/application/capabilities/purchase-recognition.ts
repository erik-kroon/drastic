import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getPurchaseRecognition, getPurchaseRecognitionByDraft } from "../purchases/recognition";

export const purchaseRecognitionCapabilities = {
  commerce_get_purchase_recognition: effectCapability(
    Capabilities.commerce_get_purchase_recognition,
    (token, input) =>
      getPurchaseRecognition(token, { scope: input.scope, recognitionId: input.id }),
  ),
  commerce_get_purchase_recognition_by_draft: effectCapability(
    Capabilities.commerce_get_purchase_recognition_by_draft,
    (token, input) =>
      getPurchaseRecognitionByDraft(token, { scope: input.scope, draftId: input.draftId }),
  ),
};
