import { Api } from "@open-erp/contracts/api";
import * as CommerceFx from "@open-erp/contracts/commerce-fx";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const CommerceFxHandlers = HttpApiBuilder.group(Api, "commerceFx", (handlers) =>
  handlers
    .handle("prepareCommerceFxRecognition", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "prepareCommerceFxRecognition",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          CommerceFx.RecognitionReview,
        ),
      ),
    )
    .handle("approveCommerceFxRecognition", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveCommerceFxRecognition",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          CommerceFx.FxApproval,
        ),
      ),
    )
    .handle("executeCommerceFxRecognition", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "executeCommerceFxRecognition",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          CommerceFx.MonetaryItem,
        ),
      ),
    )
    .handle("prepareCommerceFxSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "prepareCommerceFxSettlement",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          CommerceFx.SettlementReview,
        ),
      ),
    )
    .handle("approveCommerceFxSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveCommerceFxSettlement",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          CommerceFx.FxApproval,
        ),
      ),
    )
    .handle("executeCommerceFxSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "executeCommerceFxSettlement",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          CommerceFx.SettlementReceipt,
        ),
      ),
    )
    .handle("prepareCommerceFxPartialSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "prepareCommerceFxPartialSettlement",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          CommerceFx.PartialSettlementReview,
        ),
      ),
    )
    .handle("approveCommerceFxPartialSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveCommerceFxPartialSettlement",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          CommerceFx.FxApproval,
        ),
      ),
    )
    .handle("executeCommerceFxPartialSettlement", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "executeCommerceFxPartialSettlement",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          CommerceFx.PartialSettlementReceipt,
        ),
      ),
    )
    .handle("prepareCommerceFxSettlementCorrection", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "prepareCommerceFxSettlementCorrection",
          [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)],
          CommerceFx.SettlementCorrectionReview,
        ),
      ),
    )
    .handle("approveCommerceFxSettlementCorrection", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "approveCommerceFxSettlementCorrection",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          CommerceFx.FxApproval,
        ),
      ),
    )
    .handle("executeCommerceFxSettlementCorrection", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "executeCommerceFxSettlementCorrection",
          [
            token,
            scopeParameter(params),
            params.id,
            headers["idempotency-key"],
            JSON.stringify(payload),
          ],
          CommerceFx.CorrectionReceipt,
        ),
      ),
    )
    .handle("getCommerceFxItem", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "getCommerceFxItem",
          [token, scopeParameter(params), params.id],
          CommerceFx.MonetaryItem,
        ),
      ),
    )
    .handle("recoverCommerceFxCommand", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        query(
          "recoverCommerceFxCommand",
          [token, scopeParameter(params), params.key],
          CommerceFx.CommandRecovery,
        ),
      ),
    ),
);
