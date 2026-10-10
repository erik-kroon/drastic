import { capabilities } from "../capabilities";
import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { preparePartyResolution } from "../commerce/party-identity";

import { defineHttpOperation, bindHttpOperation } from "../capabilities/http-operation";

export const PartyIdentityOperations = {
  readDirectoryBalances: bindHttpOperation(
    Api.groups.partyIdentity.endpoints.readDirectoryBalances,
    capabilities.directory_read_balances,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  preparePartyResolution: defineHttpOperation(
    Api.groups.partyIdentity.endpoints.preparePartyResolution,
    (token, { params, headers, payload }) =>
      preparePartyResolution(token, {
        scope: scopeFromPath(params),
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
};
