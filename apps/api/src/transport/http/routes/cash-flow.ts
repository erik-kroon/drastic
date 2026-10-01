import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import { prepareCashFlowStatement } from "../../../application/reports/cash-flow-statement";

// Read-only report surface. The owner derives opening and closing cash from
// retained postings inside its own transaction, so this route carries a scope
// and the reviewed mapping and nothing else: no caller-supplied amount.
export const CashFlowHandlers = HttpApiBuilder.group(Api, "cashFlow", (handlers) =>
  handlers.handle("prepareCashFlowStatement", ({ params, payload }) =>
    Effect.flatMap(authenticate, (token) =>
      prepareCashFlowStatement(token, {
        scope: scopeFromPath(params),
        input: payload,
      }),
    ),
  ),
);
