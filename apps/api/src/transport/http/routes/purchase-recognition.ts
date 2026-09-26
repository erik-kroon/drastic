import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import * as Recognition from "../../../application/purchases/recognition";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const PurchaseRecognitionHandlers = HttpApiBuilder.group(
  Api,
  "purchaseRecognition",
  (handlers) =>
    handlers
      .handle("getPurchaseRecognition", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Recognition.getPurchaseRecognition(token, {
            scope: scopeFromPath(params),
            recognitionId: params.id,
          }),
        ),
      )
      .handle("getPurchaseRecognitionByDraft", ({ params }) =>
        Effect.flatMap(authenticate, (token) =>
          Recognition.getPurchaseRecognitionByDraft(token, {
            scope: scopeFromPath(params),
            draftId: params.draftId,
          }),
        ),
      ),
);
