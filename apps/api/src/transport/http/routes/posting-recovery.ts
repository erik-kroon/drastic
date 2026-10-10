import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PostingRecoveryOperations } from "../../../application/operations/posting-recovery";
import { operationHandlers } from "../operation-handlers";

export const PostingRecoveryHandlers = HttpApiBuilder.group(Api, "postingRecovery", (handlers) =>
  handlers.handleAll(operationHandlers(PostingRecoveryOperations)),
);
