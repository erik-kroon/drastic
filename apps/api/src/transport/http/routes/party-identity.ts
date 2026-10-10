import { Api } from "@open-erp/contracts/api";
import { HttpApiBuilder } from "effect/http-api";
import { PartyIdentityOperations } from "../../../application/operations/party-identity";
import { operationHandlers } from "../operation-handlers";

export const PartyIdentityHandlers = HttpApiBuilder.group(Api, "partyIdentity", (handlers) =>
  handlers.handleAll(operationHandlers(PartyIdentityOperations)),
);
