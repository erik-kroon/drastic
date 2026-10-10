import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { DocumentSignatureOperations } from "../../../application/operations/document-signatures";
import { operationHandlers } from "../operation-handlers";

export const DocumentSignatureHandlers = HttpApiBuilder.group(
  Api,
  "documentSignatures",
  (handlers) => handlers.handleAll(operationHandlers(DocumentSignatureOperations)),
);
