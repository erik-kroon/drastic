import { assertUniqueJsonKeys, JsonKeysError } from "../../adapters/json-keys";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

class BodyError extends Data.TaggedError("BodyError")<{
  readonly status: number;
  readonly message: string;
}> {}

const maxBodyBytes = 8 * 1024 * 1024;

// The Web Request adapter does not enforce Effect's MaxBodySize reference.
export function boundedRequest(request: Request) {
  return Effect.scoped(
    Effect.gen(function* () {
      const stream = request.body;

      if (stream === null) return request;
      const authRequest = new URL(request.url).pathname.startsWith("/api/auth/");
      const limit = authRequest ? 16 * 1024 : maxBodyBytes;

      const tooLarge = new BodyError({
        status: 413,
        message: "Request body exceeds the byte limit.",
      });

      const unreadable = new BodyError({
        status: 400,
        message: "Could not read the request body.",
      });

      const reader = yield* Effect.acquireRelease(
        Effect.try({ try: () => stream.getReader(), catch: () => unreadable }),
        (stream) =>
          Effect.tryPromise(() => stream.cancel()).pipe(
            Effect.ignore,
            Effect.andThen(Effect.sync(() => stream.releaseLock())),
          ),
      );

      if (Number(request.headers.get("content-length")) > limit) return yield* tooLarge;
      const chunks: Array<Uint8Array> = [];
      let length = 0;

      while (true) {
        const chunk = yield* Effect.tryPromise({
          try: () => reader.read(),
          catch: () => unreadable,
        });

        if (chunk.done) break;
        length += chunk.value.byteLength;

        if (length > limit) return yield* tooLarge;
        chunks.push(chunk.value);
      }

      const body = new Uint8Array(length);
      let offset = 0;

      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();

      if (!authRequest || contentType === "application/json" || contentType?.endsWith("+json")) {
        yield* Effect.try({
          try: () => assertUniqueJsonKeys(body),
          catch: (error) =>
            error instanceof JsonKeysError
              ? new BodyError({ status: 400, message: error.message })
              : new BodyError({
                  status: 400,
                  message: "Request body must use valid UTF-8 JSON.",
                }),
        });
      }

      return new Request(request, { method: request.method, body });
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () => Effect.fail(new BodyError({ status: 408, message: "Request body timed out." })),
    }),
  );
}
