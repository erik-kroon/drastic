import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import * as Deadlines from "@open-erp/contracts/deadlines";
import { query } from "../../../db/query";
import { renderDeadlineCalendar } from "../../../application/deadline-calendar";

const feed = Effect.gen(function* () {
  const params = yield* HttpRouter.params;
  const secret = params.secret?.replace(/\.ics$/, "");
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return HttpServerResponse.empty({ status: 404 });
  const result = yield* Effect.result(query("deadlineFeedEvents", [secret], Deadlines.FeedEvents));
  if (Result.isFailure(result)) return HttpServerResponse.empty({ status: 404 });
  return HttpServerResponse.text(renderDeadlineCalendar(result.success), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" },
  });
});

// Feed secrets act as bearer credentials. Never put them in logs or errors.
export const DeadlineFeedRoutes = HttpRouter.add("GET", "/api/v1/deadline-feeds/:secret", feed);
