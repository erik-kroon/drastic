import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { discoverBankMatchCandidates } from "../../../application/banking/candidates";

export const BankMatchCandidateHandlers = HttpApiBuilder.group(
  Api,
  "bankMatchCandidates",
  (handlers) =>
    handlers.handle("discoverBankMatchCandidates", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        discoverBankMatchCandidates(token, { scope: scopeFromPath(params), input: payload }),
      ),
    ),
);
