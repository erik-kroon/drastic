import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import * as Commerce from "../../../application/commerce/crm-master";

import * as Defaults from "../../../application/commerce/customer-invoice-defaults";

export const CrmMasterHandlers = HttpApiBuilder.group(Api, "crmMaster", (handlers) =>
  handlers
    .handle("crmCustomerInvoiceDefaults", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Defaults.getCustomerInvoiceDefaults(token, {
          scope: scopeFromPath(params),
          partyId: params.partyId,
          revision: query.revision,
        }),
      ),
    )
    .handle("crmCustomerRecipient", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        Defaults.getCustomerRecipient(token, {
          scope: scopeFromPath(params),
          partyId: params.partyId,
          revision: query.revision,
        }),
      ),
    )
    .handle("crmSaveCustomerInvoiceDefaults", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Defaults.saveCustomerInvoiceDefaults(token, {
          scope: scopeFromPath(params),
          partyId: params.partyId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("crmSaveCustomerRecipient", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Defaults.saveCustomerRecipient(token, {
          scope: scopeFromPath(params),
          partyId: params.partyId,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("crmApplyCustomerInvoiceDefaults", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Defaults.applyCustomerInvoiceDefaults(token, {
          scope: scopeFromPath(params),
          partyId: params.partyId,
          input: payload,
        }),
      ),
    )
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
