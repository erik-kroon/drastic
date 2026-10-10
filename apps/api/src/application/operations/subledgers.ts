import { scopeFromPath } from "../operation-scope";
import { Api } from "@open-erp/contracts/api";

import { capabilities } from "../capabilities/index";
import * as Schedules from "../subledger/schedules";
import { bindHttpOperation, defineHttpOperation } from "../capabilities/http-operation";

export const SubledgerOperations = {
  prepareScheduleOccurrence: bindHttpOperation(
    Api.groups.subledgers.endpoints.prepareScheduleOccurrence,
    capabilities.schedules_prepare,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      scheduleId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  amendScheduleEstimate: defineHttpOperation(
    Api.groups.subledgers.endpoints.amendScheduleEstimate,
    (token, { params, headers, payload }) =>
      Schedules.amendEstimate(token, {
        scope: scopeFromPath(params),
        scheduleId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  amendScheduleFutureDates: defineHttpOperation(
    Api.groups.subledgers.endpoints.amendScheduleFutureDates,
    (token, { params, headers, payload }) =>
      Schedules.amendFutureDates(token, {
        scope: scopeFromPath(params),
        scheduleId: params.id,
        idempotencyKey: headers["idempotency-key"],
        input: payload,
      }),
  ),
  reviseSchedule: bindHttpOperation(
    Api.groups.subledgers.endpoints.reviseSchedule,
    capabilities.schedules_revise,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      scheduleId: params.id,
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
  getSchedule: bindHttpOperation(
    Api.groups.subledgers.endpoints.getSchedule,
    capabilities.schedules_get,
    ({ params }) => ({
      scope: scopeFromPath(params),
      scheduleId: params.id,
    }),
  ),
  listSchedules: bindHttpOperation(
    Api.groups.subledgers.endpoints.listSchedules,
    capabilities.schedules_list,
    ({ params, query }) => ({
      scope: scopeFromPath(params),
      ...query,
    }),
  ),
  createSchedule: bindHttpOperation(
    Api.groups.subledgers.endpoints.createSchedule,
    capabilities.schedules_create,
    ({ params, headers, payload }) => ({
      scope: scopeFromPath(params),
      idempotencyKey: headers["idempotency-key"],
      input: payload,
    }),
  ),
};
