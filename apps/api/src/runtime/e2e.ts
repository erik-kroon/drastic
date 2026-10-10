import { configuredIntakeFeed } from "../adapters/intake/local-fixture";
import { configuredDocumentDelivery } from "../adapters/documents/local-fixture";
import { configuredDecisionModel } from "./decision-model";
import { createApi } from "../index";
import { configuredPeppolAccessPoint } from "../adapters/peppol/local-fixture";
import { configuredProcessorFeed } from "../adapters/processor/local-fixture";
import type { Bindings } from "./environment";

const api = createApi(true);

export default {
  fetch(request: Request, bindings: Bindings) {
    return api.fetch(request, {
      ...bindings,
      INTAKE_FEED: bindings.INTAKE_FEED ?? configuredIntakeFeed(bindings),
      DOCUMENT_DELIVERY: bindings.DOCUMENT_DELIVERY ?? configuredDocumentDelivery(bindings),
      DECISION_MODEL: bindings.DECISION_MODEL ?? configuredDecisionModel(bindings, bindings.AI),
      PEPPOL_EXCHANGE: bindings.PEPPOL_EXCHANGE ?? configuredPeppolAccessPoint(bindings),
      PROCESSOR_FEED: bindings.PROCESSOR_FEED ?? configuredProcessorFeed(bindings),
    });
  },
};
