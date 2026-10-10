import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { RuleImpactOperations } from "../../../application/operations/rule-impact";
import { operationHandlers } from "../operation-handlers";

export const RuleImpactHandlers = HttpApiBuilder.group(Api, "ruleImpact", (handlers) =>
  handlers.handleAll(operationHandlers(RuleImpactOperations)),
);
