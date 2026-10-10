import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { AccountantReviewOperations } from "../../../application/operations/accountant-review";
import { operationHandlers } from "../operation-handlers";

export const AccountantReviewHandlers = HttpApiBuilder.group(Api, "accountantReview", (handlers) =>
  handlers.handleAll(operationHandlers(AccountantReviewOperations)),
);
