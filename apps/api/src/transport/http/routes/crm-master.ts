import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/crm-master";

export const CrmMasterHandlers = HttpApiBuilder.group(Api, "crmMaster", (handlers) =>
  handlers
    .handle("crmDirectory", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readDirectory(token, {
          scope: scopeFromPath(params),
          filters: { search: query.search ?? "", role: query.role ?? "", after: query.after ?? "" },
        }),
      ),
    )
    .handle("crmDirectoryExport", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.readDirectoryExport(token, {
          scope: scopeFromPath(params),
          filters: { search: query.search ?? "", role: query.role ?? "", after: query.after ?? "" },
        }),
      ),
    )
    .handle("crmAddAnnotation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Commerce.addAnnotation(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
