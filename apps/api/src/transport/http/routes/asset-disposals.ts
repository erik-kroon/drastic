import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Owner from "../../../application/subledger/disposals";
import { authenticate } from "../auth";
import { scopeFromPath } from "../scope";

export const AssetDisposalHandlers = HttpApiBuilder.group(Api, "assetDisposals", (handlers) =>
  handlers
    .handle("getAssetDisposalInvoiceSource", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.invoiceSource(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    )
    .handle("prepareAssetProceedsDisposal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.prepare(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("approveAssetProceedsDisposal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.approve(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("executeAssetProceedsDisposal", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.execute(token, {
          scope: scopeFromPath(params),
          id: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getAssetProceedsDisposal", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        Owner.get(token, { scope: scopeFromPath(params), id: params.id }),
      ),
    ),
);
