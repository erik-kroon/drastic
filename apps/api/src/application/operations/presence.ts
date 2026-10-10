import { Api } from "@open-erp/contracts/api";

import * as Presence from "../presence";

import { defineHttpOperation } from "../capabilities/http-operation";

export const PresenceOperations = {
  completePresence: defineHttpOperation(
    Api.groups.presence.endpoints.completePresence,
    (token, { params, payload }) =>
      Presence.completePresence(token, {
        scope: { entityId: params.entityId, bookId: params.bookId },
        challengeId: params.id,
        input: payload,
      }),
  ),
  beginPresence: defineHttpOperation(
    Api.groups.presence.endpoints.beginPresence,
    (token, { params, payload }) =>
      Presence.beginPresence(token, { scope: params, input: payload }),
  ),
  completePresenceEnrollment: defineHttpOperation(
    Api.groups.presence.endpoints.completePresenceEnrollment,
    (token, { payload }) => Presence.completePresenceEnrollment(token, payload),
  ),
  beginPresenceEnrollment: defineHttpOperation(
    Api.groups.presence.endpoints.beginPresenceEnrollment,
    (token, { payload }) => Presence.beginPresenceEnrollment(token, payload),
  ),
};
