import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import { classifyAiCounterparty, readAiEgressLog } from "../src/application/ai-egress";
import { databaseLayer } from "../src/db/connection";

class AiEgressConsoleError extends Schema.TaggedError<AiEgressConsoleError>()(
  "AiEgressConsoleError",
  { message: Schema.String },
) {}

const usage =
  "Set DATABASE_URL and OPENERP_ACCESS_TOKEN. Use ai-egress.ts audit <entity> <book> [after-sequence], or classify <entity> <book> <counterparty> <revision> <company|person|sole_trader> <evidence>.";

const args = process.argv.slice(2);

const [command, entityId, bookId, subject] = args;

const revision = args[4];

const kind = args[5];

const evidenceId = args[6];

const connectionString = process.env.DATABASE_URL;

const token = process.env.OPENERP_ACCESS_TOKEN;

if (!connectionString || !token || !entityId || !bookId) throw new Error(usage);

const scope = { entityId, bookId };

const operation: Effect.Effect<unknown, unknown, import("../src/db/connection").Database> =
  command === "audit"
    ? readAiEgressLog(token, scope, subject)
    : command === "classify" &&
        subject &&
        revision &&
        evidenceId &&
        (kind === "company" || kind === "person" || kind === "sole_trader")
      ? classifyAiCounterparty(token, scope, {
          counterpartyId: subject,
          revision,
          kind,
          evidenceId,
        }).pipe(Effect.as({ recorded: true }))
      : Effect.fail(new AiEgressConsoleError({ message: usage }));

const result = await Effect.runPromise(
  operation.pipe(
    Effect.provide(
      databaseLayer({
        connectionString: Redacted.make(connectionString),
        applicationName: "ai-egress-console",
        connectTimeoutMs: 10000,
        statementTimeoutMs: 15000,
      }),
    ),
    Effect.mapError(
      () =>
        new AiEgressConsoleError({
          message:
            "AI egress operation refused. Check scope, operator authority and the retained evidence.",
        }),
    ),
  ),
);

console.info(JSON.stringify(result));
