import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Firms from "../../../application/firms";

export const FirmHandlers = HttpApiBuilder.group(Api, "firms", (handlers) =>
  handlers
    .handle("listFirms", () => Effect.flatMap(authenticate, (token) => Firms.listFirms(token)))
    .handle("getFirm", ({ params }) =>
      Effect.flatMap(authenticate, (token) => Firms.getFirm(token, { firmId: params.firmId })),
    )
    .handle("createFirm", ({ headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Firms.createFirm(token, {
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("saveFirmClient", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Firms.saveFirmClient(token, {
          firmId: params.firmId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("removeFirmClient", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Firms.removeFirmClient(token, {
          firmId: params.firmId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("saveFirmMember", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Firms.saveFirmMember(token, {
          firmId: params.firmId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
