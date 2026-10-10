import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { TreasuryLoanOperations } from "../../../application/operations/treasury-loans";
import { operationHandlers } from "../operation-handlers";

export const TreasuryLoanHandlers = HttpApiBuilder.group(Api, "treasuryLoan", (handlers) =>
  handlers.handleAll(operationHandlers(TreasuryLoanOperations)),
);
