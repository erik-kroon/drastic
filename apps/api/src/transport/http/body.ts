import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

class BodyError extends Data.TaggedError("BodyError")<{
  readonly status: number;
  readonly message: string;
}> {}

const maxBodyBytes = 8 * 1024 * 1024;

// Downstream adapters own JSON syntax/schema decoding. Inspect keys before they
// collapse duplicate members; never rewrite the original command/evidence bytes.
function assertUniqueJsonKeys(body: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
  const containers: Array<Set<string> | null> = [];

  for (let offset = 0; offset < text.length; offset++) {
    const character = text[offset];

    if (character === "{" || character === "[") {
      containers.push(character === "{" ? new Set<string>() : null);

      if (containers.length > 128) {
        throw new BodyError({
          status: 400,
          message: "JSON nesting exceeds the 128-container limit.",
        });
      }
    } else if (character === "}" || character === "]") {
      containers.pop();
    } else if (character === '"') {
      const start = offset;
      offset++;

      while (offset < text.length && text[offset] !== '"') {
        if (text[offset] === "\\") offset++;
        offset++;
      }

      let next = offset + 1;

      while (
        text[next] === " " ||
        text[next] === "\t" ||
        text[next] === "\r" ||
        text[next] === "\n"
      )
        next++;
      const keys = containers.at(-1);

      if (text[next] !== ":" || keys == null) continue;
      const key: unknown = JSON.parse(text.slice(start, offset + 1));

      if (typeof key !== "string") {
        throw new BodyError({ status: 400, message: "JSON object keys must be strings." });
      }

      if (keys.has(key)) {
        throw new BodyError({ status: 400, message: "JSON object keys must be unique." });
      }

      keys.add(key);
    }
  }
}

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
            error instanceof BodyError
              ? error
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
