import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http";
import { makeAuth } from "../../adapters/auth/better-auth";
import { failure } from "../../application/failures";
import { RequestEnvironment } from "../../runtime/environment";

export const sameOrigin = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const { bindings, url } = yield* RequestEnvironment;
  const baseURL = bindings.BETTER_AUTH_URL;
  const origin = baseURL
    ? yield* Effect.try({
        try: () => new URL(baseURL).origin,
        catch: () => failure("Unavailable"),
      })
    : url.origin;
  if (request.headers.origin !== origin || request.headers["sec-fetch-site"] === "cross-site") {
    return yield* failure("Forbidden");
  }
});

export const authenticate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const authorization = request.headers.authorization;
  if (authorization !== undefined) {
    const token = /^Bearer +([^\s]{1,2048})$/i.exec(authorization)?.[1];
    if (!token) return yield* failure("Unauthorized");
    return token;
  }
  if (!request.headers.cookie) return yield* failure("Unauthorized");
  if (request.method !== "GET" || request.headers.origin !== undefined) {
    yield* sameOrigin;
  } else if (request.headers["sec-fetch-site"] === "cross-site") {
    return yield* failure("Forbidden");
  }
  const { bindings } = yield* RequestEnvironment;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const auth = yield* makeAuth(bindings, false);
      const session = yield* Effect.tryPromise({
        try: () =>
          auth.api.getSession({
            headers: new Headers(request.headers),
            query: { disableRefresh: true },
          }),
        catch: () => failure("Unavailable"),
      });
      if (!session) return yield* failure("Unauthorized");
      // Application admission rechecks session expiry and membership under database locks.
      return session.session.token;
    }),
  );
});
