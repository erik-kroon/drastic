import { sql } from "drizzle-orm";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import * as Provenance from "@open-erp/contracts/decision-provenance";
import * as ExtractionDb from "../../src/db/purchases/extraction";
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
import { failure, logFailure } from "../../src/application/failures";
import { recordSuggestion } from "../../src/application/decision-provenance";
import { withBook } from "../../src/application/commerce/support";
import { handleExtraction } from "../../src/runtime/preparation-queue";
import {
  claimPendingSupplierExtractions,
  stopFailedExtractionDelivery,
} from "../../src/application/purchases/extraction";
import { retainSource } from "../../src/application/source-retention";

const Input = Schema.Struct({
  mode: Schema.Literals(["retain", "run", "claim", "stop", "capture"]),
  scope: Accounting.Scope,
  requestId: Schema.String,
  store: Schema.String,
  pause: Schema.Boolean,
  captureKind: Schema.optional(
    Schema.Literals(["extraction", "extraction_value", "bank", "supplier", "native"]),
  ),
  suggestionId: Schema.optional(Accounting.Identifier),
  rollback: Schema.optional(Schema.Boolean),
  captureVariant: Schema.optional(Schema.Literal("omit_title")),
  source: Schema.optional(Intake.RetainSource),
});

const input = Schema.decodeSync(Schema.fromJsonString(Input))(
  await readFile(process.argv[2]!, "utf8"),
);

const token = process.env.OPENERP_PREPARATION_TOKEN!;

const operation = Effect.gen(function* () {
  if (input.mode === "capture") {
    return yield* withBook(token, input.scope, false, function* (transaction, principal) {
      if (input.captureKind === "native") {
        const records = yield* transaction.execute<{ body: Schema.JsonObject }>(
          sql`select body from openerp.suggestion_records where book_id=${input.scope.bookId} and id=${input.suggestionId}`,
          "objects",
        );

        const served = yield* Schema.decodeUnknownEffect(Provenance.SuggestionRecord)(
          records[0]?.body,
        );

        const attempts = yield* ExtractionDb.readAttemptForRequest(
          transaction,
          input.scope.bookId,
          input.requestId,
        );

        const attempt = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            fields: Schema.Array(Extraction.ExtractedField),
            candidateLines: Schema.Array(Extraction.ExtractedLine),
          }),
        )(attempts.at(-1)?.body.extraction);

        const id = yield* recordSuggestion(
          transaction,
          input.scope.bookId,
          principal,
          served.subject,
          {
            source: "extraction",
            version: "extraction_merge_v1",
            options: [
              ...attempt.fields.map((field) => ({
                lineOrdinal: 0,
                fieldKey: field.fieldKey,
                value: field.proposedValue,
              })),
              ...attempt.candidateLines.flatMap((line, index) =>
                line.fields.map((field) => ({
                  lineOrdinal: index + 1,
                  fieldKey: field.fieldKey,
                  value: field.proposedValue,
                })),
              ),
            ]
              .filter((field) => field.value !== null)
              .filter(
                (field) =>
                  !input.rollback &&
                  (input.captureVariant !== "omit_title" || field.fieldKey !== "title"),
              ),
          },
        );

        if (input.rollback) {
          const counts = yield* transaction.execute<{ captures: number; identities: number }>(
            sql`select (select count(*)::int from openerp.suggestion_records where book_id=${input.scope.bookId}) as captures,(select count(*)::int from openerp.suggestion_identities where book_id=${input.scope.bookId}) as identities`,
            "objects",
          );

          yield* Effect.promise(() =>
            writeFile(
              join(input.store, "capture-rollback.json"),
              JSON.stringify({ id, counts: counts[0] }),
            ),
          );

          return yield* failure("InvalidJournal");
        }

        return id;
      }

      const subject = {
        kind: "supplier_draft",
        draftId: "synthetic_invalid_capture",
        revision: "1",
      } as const;

      if (input.captureKind === "bank")
        return yield* recordSuggestion(transaction, input.scope.bookId, principal, subject, {
          source: "bank_ranking_v2",
          version: "retained_then_reference_amount_date_v2",
          options: Array.from({ length: 1001 }, () => ({
            voucherId: "synthetic_voucher",
            lineId: "synthetic_line",
            amountMinor: "10000",
          })),
        });

      if (input.captureKind === "supplier")
        return yield* recordSuggestion(transaction, input.scope.bookId, principal, subject, {
          source: "firm_memory_v0",
          version: "supplier_account_history_v1",
          options: Array.from({ length: 6 }, () => ({
            expenseAccountId: "account_bank",
            vatRatePercent: 0 as const,
            sourceInvoiceId: "synthetic_invoice",
          })),
        });

      return yield* recordSuggestion(transaction, input.scope.bookId, principal, subject, {
        source: "extraction",
        version: "extraction_merge_v1",
        options: Array.from({ length: input.captureKind === "extraction_value" ? 1 : 865 }, () => ({
          lineOrdinal: 0,
          fieldKey: "title",
          value: input.captureKind === "extraction_value" ? "x".repeat(1001) : "Synthetic",
        })),
      });
    });
  }

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
    Effect.tapError(logFailure),
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

            try {
              return new Uint8Array(await readFile(join(input.store, key.replaceAll("/", "_"))));
            } catch (error) {
              if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
              throw error;
            }
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
