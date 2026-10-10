import { HttpOperationLayers } from "./transport/http/operation-layers";
import { configuredDocumentDelivery } from "./adapters/documents/local-fixture";
import { DeadlineFeedRoutes } from "./transport/http/routes/deadline-feed";
import { Api } from "@open-erp/contracts/api";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import { fixedApplicationClock } from "./runtime/application-clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { AccountingError } from "@open-erp/contracts/accounting";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { authHandler } from "./adapters/auth/better-auth";
import { authConfiguration } from "./adapters/auth/configuration";
import { BodyError, boundedRequest } from "./transport/http/body";
import { McpRoutes } from "./transport/mcp";
import { type Bindings, RequestEnvironment } from "./runtime/environment";
import { AccountingErrorStatus } from "@open-erp/contracts/api";
import { databaseFailure, withRequestDatabase } from "./db/transaction";
import { Database } from "./db/connection";
import { failure, logFailure } from "./application/failures";

const SystemHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers
    .handle("health", () => Effect.succeed({ status: "ok" }))
    .handle(
      "status",
      Effect.fn("System.status")(function* () {
        return {
          status: "ok" as const,
          service: "open-erp-api" as const,
          effectVersion: "4.0.0-rc.112" as const,
          checkedAt: yield* Clock.currentTimeMillis,
        };
      }),
    ),
);

const ApiRoutes = HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([SystemHandlers, HttpOperationLayers]),
  Layer.provide(HttpServer.layerServices),
);

const { handler } = HttpRouter.toWebHandler(
  Layer.mergeAll(ApiRoutes, McpRoutes, DeadlineFeedRoutes),
  {
    disableLogger: true,
  },
);

function boundaryResponse(error: unknown) {
  if (error instanceof BodyError) {
    return Response.json(
      new AccountingError({
        code: error.code,
        message: error.message,
        recovery: error.status === 408 ? "transient" : "permanent",
      }),
      { status: error.status },
    );
  }

  const safe = databaseFailure(error);

  return Response.json(safe, { status: AccountingErrorStatus[safe.code] });
}

async function httpFailureResponse(response: Response, path: string) {
  if (response.status < 400 || !path.startsWith("/api/v1/")) return response;

  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);

  const decoded = Schema.decodeUnknownOption(AccountingError)(body);

  const error = Option.match(decoded, {
    onSome: databaseFailure,
    onNone: () =>
      Match.value(response.status).pipe(
        Match.when(400, () => failure("InvalidRequest")),
        Match.when(401, () => failure("Unauthorized")),
        Match.when(403, () => failure("Forbidden")),
        Match.when(404, () => failure("NotFound")),
        Match.when(405, () => failure("MethodNotAllowed")),
        Match.when(503, () => failure("Unavailable")),
        Match.orElse(() => failure("InternalError")),
      ),
  });

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");

  return Response.json(error, { status: response.status, headers });
}

export function createApi(e2e: boolean) {
  return {
    async fetch(request: Request, bindings: Bindings): Promise<Response> {
      const requestId = crypto.randomUUID();

      const annotations = {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
      };

      const testNow = request.headers.get("x-openerp-test-now");

      const response = await Effect.runPromise(
        boundedRequest(request).pipe(
          Effect.matchEffect({
            onFailure: (error) => Effect.succeed(boundaryResponse(error)),
            onSuccess: (bounded) => {
              if (testNow !== null && !e2e)
                return Effect.succeed(boundaryResponse(failure("Forbidden")));

              const instant =
                testNow === null
                  ? null
                  : fixedApplicationClock(testNow, Clock.Clock.defaultValue());

              if (testNow !== null && instant === null)
                return Effect.succeed(boundaryResponse(failure("InvalidRequest")));

              const pathname = new URL(bounded.url).pathname;

              if (pathname === "/.well-known/oauth-protected-resource/api/mcp")
                return authConfiguration(bindings).pipe(
                  Effect.map(({ url }) =>
                    Response.json({
                      resource: `${url.origin}/api/mcp`,
                      authorization_servers: [`${url.origin}/api/auth`],
                      scopes_supported: ["mcp:read"],
                      bearer_methods_supported: ["header"],
                    }),
                  ),
                  Effect.orElseSucceed(() => new Response(null, { status: 503 })),
                );

              if (
                pathname.startsWith("/api/auth/") ||
                pathname === "/.well-known/oauth-authorization-server/api/auth" ||
                pathname === "/.well-known/openid-configuration/api/auth"
              )
                return authHandler(bounded, bindings);

              const application = withRequestDatabase(
                bindings,
                Effect.gen(function* () {
                  const db = yield* Database;

                  const documentDelivery = yield* Effect.try({
                    try: () => bindings.DOCUMENT_DELIVERY ?? configuredDocumentDelivery(bindings),
                    catch: () => failure("ConfigurationError"),
                  });

                  return yield* Effect.tryPromise({
                    try: () =>
                      handler(
                        bounded,
                        Context.make(RequestEnvironment, {
                          bindings: { ...bindings, DOCUMENT_DELIVERY: documentDelivery },
                          url: new URL(request.url),
                        }).pipe(
                          Context.add(Database, db),
                          Context.add(References.CurrentLogAnnotations, annotations),
                          (context) =>
                            instant === null ? context : Context.add(context, Clock.Clock, instant),
                        ),
                      ),
                    catch: databaseFailure,
                  });
                }),
              );

              return application;
            },
          }),
          Effect.catchCause((cause) => {
            if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);

            const safe = databaseFailure(Cause.squash(cause));

            return logFailure(safe).pipe(Effect.as(boundaryResponse(safe)));
          }),
          Effect.annotateLogs(annotations),
        ),
      );

      const publicResponse = await httpFailureResponse(response, annotations.path);
      publicResponse.headers.set("cache-control", "no-store");
      publicResponse.headers.set("x-request-id", requestId);

      return publicResponse;
    },
  };
}

export default createApi(false);
