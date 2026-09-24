import { Api } from "@open-erp/contracts/api";
import * as Deadlines from "@open-erp/contracts/deadlines";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { authenticate } from "../auth";
import { query, scopeParameter } from "../../../db/query";

export const DeadlineHandlers = HttpApiBuilder.group(Api, "deadlines", (handlers) => handlers
  .handle("listDeadlines", ({ params }) => Effect.flatMap(authenticate, token => query("listDeadlines", [token, scopeParameter(params)], Deadlines.DeadlineList)))
  .handle("saveDeadline", ({ params, payload }) => Effect.flatMap(authenticate, token => query("saveDeadline", [token, scopeParameter(params), params.id, payload.expectedRevision === null ? "" : String(payload.expectedRevision), JSON.stringify(payload.input)], Deadlines.Deadline)))
  .handle("deadlineActivity", ({ params, payload }) => Effect.flatMap(authenticate, token => query("deadlineActivity", [token, scopeParameter(params), params.id, payload.action, payload.reference ?? ""], Deadlines.Deadline)))
  .handle("createDeadlineFeed", ({ params }) => Effect.flatMap(authenticate, token => query("createDeadlineFeed", [token, scopeParameter(params), params.id], Deadlines.DeadlineFeed)))
  .handle("revokeDeadlineFeed", ({ params }) => Effect.flatMap(authenticate, token => query("revokeDeadlineFeed", [token, scopeParameter(params), params.id], Deadlines.RevokedDeadlineFeed))));
