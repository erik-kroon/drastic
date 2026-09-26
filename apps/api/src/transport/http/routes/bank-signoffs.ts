import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import {
  getBankSignoff,
  listBankSignoffs,
  prepareBankSignoff,
  signBankReconciliation,
} from "../../../application/banking/signoffs";

export const BankSignoffHandlers = HttpApiBuilder.group(Api, "bankSignoffs", (handlers) =>
  handlers
    .handle("prepareBankSignoff", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        prepareBankSignoff(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("signBankReconciliation", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        signBankReconciliation(token, {
          scope: scopeFromPath(params),
          planId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("getBankSignoff", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        getBankSignoff(token, { scope: scopeFromPath(params), planId: params.id }),
      ),
    )
    .handle("listBankSignoffs", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        listBankSignoffs(token, { scope: scopeFromPath(params) }),
      ),
    ),
);
