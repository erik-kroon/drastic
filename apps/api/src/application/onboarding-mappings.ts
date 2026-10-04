import * as Effect from "effect/Effect";
import * as Mapping from "../../../../packages/contracts/src/onboarding-mappings";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Db from "../db/onboarding-mappings";
import * as SourceDb from "../db/sie-import";
import * as Ledger from "../db/posting";
import { withAdmittedPrincipal } from "./identity";
import { decode, toJsonObject, type Scope } from "./commerce/support";
import { readSourceOccurrenceInTransaction } from "./source-retention";
import { replay, saveCommand, isoNow, newId } from "./posting";
import { failure } from "./failures";
import { databaseFailure, type Transaction } from "../db/transaction";

function mappingSource(tx: Transaction, scope: Scope, previewId: string) {
  return Effect.gen(function* () {
    const row = (yield* SourceDb.readPreview(tx, scope.bookId, previewId))[0];

    if (!row) return yield* failure("NotFound");
    const preview = yield* decode(Sie.SiePreview, row.body);
    const occurrence = yield* readSourceOccurrenceInTransaction(tx, scope, preview.occurrenceId);

    return { preview, occurrence };
  });
}

export const saveOnboardingMapping = Effect.fn("onboarding.mapping.save")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Mapping.SaveOnboardingMapping.Type;
  },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const input = yield* toJsonObject(command.input);
        const replayed = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          "save_onboarding_mapping",
          principal.actorId,
          input,
          Mapping.OnboardingMapping,
        );

        if (replayed.previous) return replayed.previous;
        const { preview, occurrence } = yield* mappingSource(
          tx,
          command.scope,
          command.input.previewId,
        );

        if (preview.digest !== command.input.expectedPreviewDigest)
          return yield* failure("StaleDependency");

        if (
          !preview.vouchers.some((voucher) =>
            voucher.transactions.some((entry) => entry.account === command.input.sourceAccount),
          ) &&
          !preview.controls.some((control) => control.account === command.input.sourceAccount)
        )
          return yield* failure("InvalidJournal");
        const target = (yield* Ledger.readAccounts(tx, command.scope.bookId, [
          command.input.accountId,
        ]))[0];

        if (!target) return yield* failure("AccountMissing");

        if (!target.active) return yield* failure("AccountInactive");
        const rows = yield* Db.readMappingHistory(
          tx,
          command.scope.bookId,
          occurrence.sourceSystem,
          occurrence.sourceAccountId,
        );

        if (rows.length > 1000) return yield* failure("UnsupportedProfile");
        const history = yield* Effect.forEach(rows, (row) =>
          decode(Mapping.OnboardingMapping, row.body),
        );
        const latest = history.find(
          (choice) => choice.sourceAccount === command.input.sourceAccount,
        );

        if ((latest?.revision ?? 0) !== command.input.expectedRevision)
          return yield* failure("StaleDependency");

        const retained = yield* toJsonObject({
          id: newId("onboardingmapping"),
          scope: command.scope,
          previewId: preview.id,
          previewDigest: preview.digest,
          occurrenceId: occurrence.id,
          sourceSystem: occurrence.sourceSystem,
          sourceAccountId: occurrence.sourceAccountId,
          sourceAccount: command.input.sourceAccount,
          accountId: target.id,
          remember: command.input.remember,
          revision: (latest?.revision ?? 0) + 1,
          actorId: principal.actorId,
          chosenAt: yield* isoNow(tx),
          kind: "reviewed_source_account_mapping_v1",
        });

        const result = yield* decode(Mapping.OnboardingMapping, retained);
        yield* Db.insertMapping(tx, {
          bookId: command.scope.bookId,
          id: result.id,
          sourceSystem: result.sourceSystem,
          sourceAccountId: result.sourceAccountId,
          sourceAccount: result.sourceAccount,
          accountId: result.accountId,
          revision: result.revision,
          body: retained,
        });
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
          replayed.expected,
          "save_onboarding_mapping",
          principal.actorId,
          result,
        );

        return result;
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});

export const getOnboardingMappings = Effect.fn("onboarding.mapping.get")(function* (
  token: string,
  command: { scope: Scope; previewId: string },
) {
  return yield* withAdmittedPrincipal({ token }, command.scope, { operatorOnly: false }, (tx) =>
    Effect.gen(function* () {
      const { preview, occurrence } = yield* mappingSource(tx, command.scope, command.previewId);
      const rows = yield* Db.readMappingHistory(
        tx,
        command.scope.bookId,
        occurrence.sourceSystem,
        occurrence.sourceAccountId,
      );

      if (rows.length > 1000) return yield* failure("UnsupportedProfile");
      const history = yield* Effect.forEach(rows, (row) =>
        decode(Mapping.OnboardingMapping, row.body),
      );
      const seen = new Set<string>();

      const current = history.filter((choice) => {
        if (seen.has(choice.sourceAccount)) return false;
        seen.add(choice.sourceAccount);

        return choice.remember || choice.previewId === preview.id;
      });

      const proposedDefaults = yield* Db.rememberedMappingDefaults(
        tx,
        command.scope.bookId,
        occurrence.sourceSystem,
        occurrence.sourceAccountId,
      );

      if (proposedDefaults.length > 500) return yield* failure("UnsupportedProfile");

      return { scope: command.scope, previewId: preview.id, current, history, proposedDefaults };
    }).pipe(Effect.mapError(databaseFailure)),
  );
});
