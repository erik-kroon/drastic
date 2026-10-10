import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/http-api";
import { authenticate } from "../auth";
import * as Presence from "../../../application/presence";

export const PresenceHandlers = HttpApiBuilder.group(Api, "presence", (handlers) =>
  handlers
    .handle("beginPresenceEnrollment", ({ payload }) =>
      Effect.flatMap(authenticate, (token) => Presence.beginPresenceEnrollment(token, payload)),
    )
    .handle("completePresenceEnrollment", ({ payload }) =>
      Effect.flatMap(authenticate, (token) => Presence.completePresenceEnrollment(token, payload)),
    )
    .handle("beginPresence", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Presence.beginPresence(token, { scope: params, input: payload }),
      ),
    )
    .handle("completePresence", ({ params, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        Presence.completePresence(token, {
          scope: { entityId: params.entityId, bookId: params.bookId },
          challengeId: params.id,
          input: payload,
        }),
      ),
    ),
);
