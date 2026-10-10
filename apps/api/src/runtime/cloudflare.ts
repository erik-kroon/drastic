import api from "../index";
import { configuredDecisionModel } from "./decision-model";
import type { Bindings } from "./environment";

export default {
  fetch(request: Request, bindings: Bindings) {
    return api.fetch(request, {
      ...bindings,
      DECISION_MODEL: bindings.DECISION_MODEL ?? configuredDecisionModel(bindings, bindings.AI),
    });
  },
};
