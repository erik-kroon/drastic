import { createHash } from "node:crypto";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AiEgress,
  AiEgressError,
  AiState,
  IdentityRegistry,
  type AiIdentity,
  type AiProvider,
  type AiCategory,
} from "../adapters/ai-egress";
import * as EgressDb from "../db/ai-egress";
import { Database } from "../db/connection";
import { databaseFailure, type Transaction } from "../db/transaction";
import { digest, newId } from "./posting";
import { failure } from "./failures";
import * as Shared from "./purchases/shared";

type Scope = typeof Accounting.Scope.Type;

function providerPolicy(provider: AiProvider) {
  if (
    !provider.approval.trim() ||
    !["local-fixture", "eu-no-training-no-retention", "self-hosted"].includes(provider.policy)
  )
    throw new AiEgressError();

  return `${provider.policy}:${provider.approval}`;
}

function registry(tx: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const rows = yield* EgressDb.readIdentities(tx, bookId);
    const grouped = new Map<string, EgressDb.StoredAiIdentity[]>();

    for (const row of rows) {
      if (!row.name || !row.alias) return yield* failure("MissingEvidence");

      const aliases = grouped.get(row.subjectKey) ?? [];
      aliases.push(row);
      grouped.set(row.subjectKey, aliases);
    }

    const identities: AiIdentity[] = [];

    for (const [subjectKey, aliases] of grouped) {
      const first = aliases[0]!;
      const token = (yield* EgressDb.allocateToken(tx, bookId, subjectKey, first.kind))[0];

      if (!token) return yield* failure("IdempotencyConflict");

      if (token.kind === "CLIENT" || token.kind === "PERSON") {
        for (const alias of aliases)
          yield* EgressDb.retainAlias(tx, bookId, subjectKey, alias.alias);
      }

      identities.push({
        kind: token.kind,
        token: `[${token.kind}_${token.ordinal}]`,
        name: first.name,
        aliases: aliases.map((row) => row.alias),
      });
    }

    return new IdentityRegistry(bookId, identities);
  });
}

export function openAiEgress(
  token: string,
  scope: Scope,
  purpose: "decision" | "document" | "agent",
) {
  return Effect.gen(function* () {
    const db = yield* Database;
    yield* Shared.withBook(token, scope, false, "share", () => Effect.void);

    const capture = <A>(
      use: (transaction: Transaction, principal: Shared.Principal) => Effect.Effect<A, unknown>,
    ) =>
      Effect.runPromise(
        Shared.withBook(token, scope, false, "update", use).pipe(
          Effect.provideService(Database, db),
        ),
      );

    return new AiEgress({
      structured: (provider, input, categories) =>
        capture((tx, principal) =>
          Effect.gen(function* () {
            const policy = yield* Effect.try({
              try: () => providerPolicy(provider),
              catch: () => failure("InvalidRequest"),
            });

            const identities = yield* registry(tx, scope.bookId);

            const payload = yield* Effect.try({
              try: () => {
                const tokenised = identities.tokenize(input);

                if (
                  purpose === "decision" &&
                  tokenised !== null &&
                  typeof tokenised === "object" &&
                  !Array.isArray(tokenised) &&
                  "state" in tokenised &&
                  input !== null &&
                  typeof input === "object" &&
                  "state" in input &&
                  Schema.is(AiState)(input.state)
                )
                  return Object.fromEntries([
                    ...Object.entries(tokenised),
                    ["state", JSON.stringify(identities.tokenizeState(input.state))],
                  ]);

                return tokenised;
              },
              catch: () => failure("InvalidRequest"),
            });

            const encoded = JSON.stringify(payload);
            const disclosed = new Set<AiCategory>(categories);

            if (/\[CLIENT_[0-9]+\]/.test(encoded)) disclosed.add("client_identity_tokens");

            if (/\[(?:PERSON_[0-9]+|PERSONAL_ID_[0-9a-f]+)\]/.test(encoded))
              disclosed.add("person_identity_tokens");

            if (/\[(?:SUPPLIER|CUSTOMER)_[0-9]+\]/.test(encoded))
              disclosed.add("private_counterparty_identity_tokens");

            const payloadDigest = yield* digest(payload);
            yield* EgressDb.insertAdmission(tx, {
              bookId: scope.bookId,
              id: newId("ai_egress"),
              actorId: principal.actorId,
              purpose,
              provider: provider.provider,
              destination: provider.destination,
              modelRelease: provider.modelRelease,
              operation: "structured",
              disclosure: "tokenised",
              categories: [...disclosed],
              policy,
              payloadDigest,
            });

            return { payload, registry: identities };
          }),
        ),
      raw: (provider, operation, payload) =>
        capture((tx, principal) =>
          Effect.gen(function* () {
            if (purpose !== "document") return yield* failure("Forbidden");

            const policy = yield* Effect.try({
              try: () => providerPolicy(provider),
              catch: () => failure("InvalidRequest"),
            });

            const payloadDigest = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
            yield* EgressDb.insertAdmission(tx, {
              bookId: scope.bookId,
              id: newId("ai_egress"),
              actorId: principal.actorId,
              purpose,
              provider: provider.provider,
              destination: provider.destination,
              modelRelease: provider.modelRelease,
              operation,
              disclosure: operation === "document_submit" ? "raw_document" : "operation_reference",
              categories:
                operation === "document_submit" ? ["raw_document"] : ["operation_reference"],
              policy,
              payloadDigest,
            });
          }),
        ),
    });
  });
}

const Classification = Schema.Struct({
  counterpartyId: Accounting.Identifier,
  revision: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,17}$/)),
  kind: Schema.Literals(["company", "person", "sole_trader"]),
  evidenceId: Accounting.Identifier,
});

export function classifyAiCounterparty(
  token: string,
  scope: Scope,
  raw: typeof Classification.Type,
) {
  return Schema.decodeUnknownEffect(Classification)(raw, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => failure("InvalidJournal")),
    Effect.flatMap((input) =>
      Shared.withBook(token, scope, true, "update", (tx, principal) =>
        Effect.gen(function* () {
          const inserted = yield* EgressDb.classifyCounterparty(
            tx,
            scope.bookId,
            principal.actorId,
            input,
          );

          if (inserted.length !== 1) return yield* failure("IdempotencyConflict");
        }).pipe(Effect.mapError(databaseFailure)),
      ),
    ),
  );
}

export function readAiEgressLog(token: string, scope: Scope, after = "") {
  if (after !== "" && !/^(0|[1-9][0-9]{0,17})$/.test(after)) return failure("InvalidJournal");

  return Shared.withBook(token, scope, true, "share", (tx) =>
    EgressDb.readAdmissions(tx, scope.bookId, after),
  );
}
