import { scopeFromPath } from "../scope";
import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import {
  preparePartyResolution,
  readDirectoryBalances,
} from "../../../application/commerce/party-identity";

// The party-identity surface over the existing party directory owner. A
// resolution records a reviewed identity decision and its invalidation list;
// it merges no balance and rewrites no payee fact. The balance view groups
// retained open obligations by the resolved identity without netting across
// parties or currencies.
export const PartyIdentityHandlers = HttpApiBuilder.group(Api, "partyIdentity", (handlers) =>
  handlers
    .handle("preparePartyResolution", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        preparePartyResolution(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("readDirectoryBalances", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        readDirectoryBalances(token, {
          scope: scopeFromPath(params),
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
