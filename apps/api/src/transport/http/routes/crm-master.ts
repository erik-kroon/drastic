import { Api } from "@open-erp/contracts/api";
import * as Crm from "@open-erp/contracts/crm-master";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const CrmMasterHandlers = HttpApiBuilder.group(Api, "crmMaster", (handlers) =>
  handlers
    .handle("crmDirectory", ({ params, query: filters }) =>
      Effect.flatMap(authenticate, (token) => query("crmDirectory", [token, scopeParameter(params), filters.search ?? "", filters.role ?? "", filters.after ?? ""], Crm.DirectoryPage)))
    .handle("crmDirectoryExport", ({ params, query: filters }) =>
      Effect.flatMap(authenticate, (token) => query("crmDirectoryExport", [token, scopeParameter(params), filters.search ?? "", filters.role ?? "", filters.after ?? ""], Crm.DirectoryExport)))
    .handle("crmAddAnnotation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) => query("crmAddAnnotation", [token, scopeParameter(params), headers["idempotency-key"], JSON.stringify(payload)], Crm.Annotation))),
);
