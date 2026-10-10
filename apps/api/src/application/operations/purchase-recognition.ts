import { capabilities } from "../capabilities";
import { Api } from "@open-erp/contracts/api";

import { scopeFromPath } from "../operation-scope";

import { bindHttpOperation } from "../capabilities/http-operation";

export const PurchaseRecognitionOperations = {
  getPurchaseRecognitionByDraft: bindHttpOperation(
    Api.groups.purchaseRecognition.endpoints.getPurchaseRecognitionByDraft,
    capabilities.commerce_get_purchase_recognition_by_draft,
    ({ params }) => ({
      scope: scopeFromPath(params),
      draftId: params.draftId,
    }),
  ),
  getPurchaseRecognition: bindHttpOperation(
    Api.groups.purchaseRecognition.endpoints.getPurchaseRecognition,
    capabilities.commerce_get_purchase_recognition,
    ({ params }) => ({ scope: scopeFromPath(params), id: params.id }),
  ),
};
