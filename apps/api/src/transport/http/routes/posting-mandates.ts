import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PostingMandateOperations } from "../../../application/operations/posting-mandates";
import { operationHandlers } from "../operation-handlers";

export const PostingMandateHandlers = HttpApiBuilder.group(Api, "postingMandates", (handlers) =>
  handlers.handleAll(operationHandlers(PostingMandateOperations)),
);
