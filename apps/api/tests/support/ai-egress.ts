import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { openAiEgress } from "../../src/application/ai-egress";
import type { AiEgress } from "../../src/adapters/ai-egress";
import { databaseLayer } from "../../src/db/connection";
import { environment, type BookFixture } from "./fixtures";

export function withAiEgress<A>(book: BookFixture, use: (egress: AiEgress) => Promise<A>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const egress = yield* openAiEgress(
        book.token,
        { entityId: book.entityId, bookId: book.bookId },
        "decision",
      );

      return yield* Effect.tryPromise(() => use(egress));
    }).pipe(
      Effect.provide(
        databaseLayer({
          connectionString: Redacted.make(environment().runtimeUrl),
          applicationName: "synthetic-egress",
          connectTimeoutMs: 10000,
          statementTimeoutMs: 15000,
        }),
      ),
    ),
  );
}
