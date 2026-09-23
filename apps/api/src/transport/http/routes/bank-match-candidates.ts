import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { capabilities } from "../../../application/capabilities";

export const BankMatchCandidateHandlers = HttpApiBuilder.group(Api, "bankMatchCandidates", (handlers) =>
  handlers.handle("discoverBankMatchCandidates", ({ params, payload }) =>
    Effect.gen(function*() {
      const token = yield* authenticate;
      return yield* capabilities.bank_discover_match_candidates.execute(token, { scope: params, input: payload });
    }),
  ),
);
