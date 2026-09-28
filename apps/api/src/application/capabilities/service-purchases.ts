import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import {
  getServicePurchaseRecognition,
  getServicePurchaseReview,
  servicePurchaseHistory,
} from "../purchases/service-purchases";

export const servicePurchaseCapabilities = {
  commerce_get_service_purchase_review: effectCapability(
    Capabilities.commerce_get_service_purchase_review,
    (token, input) => getServicePurchaseReview(token, { scope: input.scope, reviewId: input.id }),
  ),
  commerce_service_purchase_history: effectCapability(
    Capabilities.commerce_service_purchase_history,
    (token, input) => servicePurchaseHistory(token, { scope: input.scope, draftId: input.id }),
  ),
  commerce_get_service_purchase_recognition: effectCapability(
    Capabilities.commerce_get_service_purchase_recognition,
    (token, input) =>
      getServicePurchaseRecognition(token, { scope: input.scope, recognitionId: input.id }),
  ),
};
