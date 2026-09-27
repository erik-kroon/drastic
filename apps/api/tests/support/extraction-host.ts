import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Intake from "@open-erp/contracts/source-intake";
import { databaseLayer } from "../../src/db/connection";
import { RequestEnvironment } from "../../src/runtime/environment";
import { handleExtraction } from "../../src/runtime/preparation-queue";
import {
  claimPendingSupplierExtractions,
  stopFailedExtractionDelivery,
} from "../../src/application/purchases/extraction";
import { retainSource } from "../../src/application/source-retention";

const Input = Schema.Struct({
  mode: Schema.Literals(["retain", "run", "claim", "stop"]),
  scope: Accounting.Scope,
  requestId: Schema.String,
  store: Schema.String,
  pause: Schema.Boolean,
  source: Schema.optional(Intake.RetainSource),
});

const input = Schema.decodeSync(Schema.fromJsonString(Input))(
  await readFile(process.argv[2]!, "utf8"),
);

const token = process.env.OPENERP_PREPARATION_TOKEN!;

const operation = Effect.gen(function* () {
  if (input.mode === "retain") {
    if (!input.source) throw new Error("Retain requires source input");

    return yield* retainSource(token, {
      scope: input.scope,
      idempotencyKey: crypto.randomUUID(),
      input: input.source,
    });
  }

  if (input.mode === "claim") return yield* claimPendingSupplierExtractions(token);

  const payload = { scope: input.scope, requestId: input.requestId };

  if (input.mode === "stop") return yield* stopFailedExtractionDelivery(payload);

  return yield* handleExtraction(payload);
});

const result = await Effect.runPromise(
  operation.pipe(
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(process.env.DATABASE_URL!),
        applicationName: "review-extraction-e2e",
        connectTimeoutMs: 5000,
        statementTimeoutMs: 10000,
      }),
    ),
    Effect.provideService(RequestEnvironment, {
      url: new URL("http://extraction.e2e.invalid"),
      bindings: {
        OPENERP_PREPARATION_TOKEN: token,
        EVIDENCE_STORE: {
          async put(key, bytes) {
            await writeFile(join(input.store, key.replaceAll("/", "_")), bytes);
          },
          async get(key) {
            await writeFile(join(input.store, "read-started"), key);

            if (input.pause) {
              const deadline = Date.now() + 15000;

              while (!existsSync(join(input.store, "release-read"))) {
                if (Date.now() >= deadline) throw new Error("Object read barrier timed out");
                await delay(20);
              }
            }

            return new Uint8Array(await readFile(join(input.store, key.replaceAll("/", "_"))));
          },
        },
      },
    }),
    Effect.match({
      onSuccess: (value) => ({ ok: true, value }),
      onFailure: (error) => ({
        ok: false,
        code: error instanceof Accounting.AccountingError ? error.code : "DatabaseFailure",
      }),
    }),
  ),
);

console.log(JSON.stringify(result));
