import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";
export const FirmHandlers = HttpApiBuilder.group(Api, "firms", (handlers) =>
  handlers
    .handle("listFirms", () =>
      Effect.flatMap(authenticate, (token) => capabilities.firm_list.execute(token, {})),
    )
    .handle("getFirm", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.firm_get.execute(token, { firmId: params.firmId }),
      ),
    )
    .handle("createFirm", ({ headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.firm_create.execute(token, {
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("saveFirmClient", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.firm_save_client.execute(token, {
          firmId: params.firmId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("removeFirmClient", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.firm_remove_client.execute(token, {
          firmId: params.firmId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("saveFirmMember", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.firm_save_member.execute(token, {
          firmId: params.firmId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
