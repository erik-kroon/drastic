import { Api } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "./auth";
import { capabilities } from "./capabilities";

export const SubledgerHandlers = HttpApiBuilder.group(Api, "subledgers", (handlers) =>
  handlers
    .handle("createSchedule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.schedules_create.execute(token, {
          scope: params,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("listSchedules", ({ params, query }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.schedules_list.execute(token, {
          scope: params,
          ...query,
        }),
      ),
    )
    .handle("getSchedule", ({ params }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.schedules_get.execute(token, {
          scope: params,
          scheduleId: params.id,
        }),
      ),
    )
    .handle("reviseSchedule", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.schedules_revise.execute(token, {
          scope: params,
          scheduleId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    )
    .handle("prepareScheduleOccurrence", ({ params, headers, payload }) =>
      Effect.flatMap(authenticate, (token) =>
        capabilities.schedules_prepare.execute(token, {
          scope: params,
          scheduleId: params.id,
          idempotencyKey: headers["idempotency-key"],
          input: payload,
        }),
      ),
    ),
);
