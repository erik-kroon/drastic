import { runBookCommand } from "../book-commands";
import { requireResolvedImportReview } from "./import-review";
import * as O from "@open-erp/contracts/onboarding";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Cases from "../../db/onboarding";
import * as Db from "../../db/onboarding-imports";
import * as Ledger from "../../db/posting";
import * as SourceDb from "../../db/sie-import";
import { databaseFailure } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { withAdmittedPrincipal } from "../identity";

import { startSourceRunInTransaction, advanceSourceRunInTransaction } from "../sie/import";
import { selectBasisInTransaction } from "../sie/historical-basis";
import { startFinancialRunInTransaction } from "../sie/historical-financial";
import { readPlan } from "../sie/historical-shared";

export const startOnboardingImport = Effect.fn("onboarding.import.start")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof O.StartOnboardingImport.Type },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const { input, scope, idempotencyKey } = command;

        const operation = "start_onboarding_import";

        return yield* runBookCommand(
          tx,
          {
            scope: scope,
            idempotencyKey: idempotencyKey,
            operation: operation,
            actorId: principal.actorId,
            input: input,
          },
          O.OnboardingImportStart,
          Effect.gen(function* () {
            const record = (yield* Cases.readCurrent(tx, scope.bookId))[0];

            if (!record) return yield* failure("NotFound");

            const current = yield* decode(O.OnboardingCase, record.body);

            const plan = yield* readPlan(tx, scope, input.sourcePlanId);

            const dates = current.configuration.dates;

            if (
              current.revision !== input.expectedRevision ||
              plan.digest !== input.expectedSourcePlanDigest ||
              current.configuration.migrationDepth !== "current_fiscal_year" ||
              !dates.historyStartsOn ||
              !dates.historyEndsOn ||
              !dates.candidateLiveOn ||
              dates.historyEndsOn >= dates.candidateLiveOn
            )
              return yield* failure("StaleDependency");

            if ((yield* Db.readQualifiedPlan(tx, scope.bookId, plan.id, plan.digest)).length === 0)
              return yield* failure("ApprovalRequired");

            const previewRecord = (yield* SourceDb.readPreview(
              tx,
              scope.bookId,
              plan.previewId,
            ))[0];

            if (!previewRecord) return yield* failure("NotFound");

            const preview = yield* decode(Sie.SiePreview, previewRecord.body);
            yield* requireResolvedImportReview(tx, scope, preview.id);

            for (const voucher of preview.vouchers) {
              const date = `${voucher.date.slice(0, 4)}-${voucher.date.slice(4, 6)}-${voucher.date.slice(6, 8)}`;

              if (
                date < dates.historyStartsOn ||
                date > dates.historyEndsOn ||
                date >= dates.candidateLiveOn
              )
                return yield* failure("UnsupportedProfile");
            }

            const historyEndsOn = dates.historyEndsOn;

            const years = yield* Ledger.readAllFiscalYears(tx, scope.bookId);

            const year = years.find(
              (entry) => entry.startsOn === dates.historyStartsOn && entry.endsOn >= historyEndsOn,
            );

            if (!year) return yield* failure("UnsupportedProfile");

            const sourceRun = yield* startSourceRunInTransaction(tx, principal, {
              scope,
              id: plan.id,
              digest: plan.digest,
              idempotencyKey: `${idempotencyKey}_source`,
            });

            const count = Math.ceil(plan.voucherCount / 200);

            if (count < 1 || count > 3) return yield* failure("UnsupportedProfile");

            let firstOrdinal = 1;

            for (let index = 0; index < count; index++) {
              const chunk = yield* advanceSourceRunInTransaction(tx, principal, {
                scope,
                id: sourceRun.id,
                idempotencyKey: `${idempotencyKey}_stage_${index}`,
                input: { fence: sourceRun.fence, planDigest: plan.digest, firstOrdinal },
              });

              firstOrdinal = chunk.lastOrdinal + 1;
            }

            const controls = plan.input.openingControls.map((control) => {
              const accountId = plan.input.mappings.find(
                (mapping) => mapping.sourceAccount === control.sourceAccount,
              )?.accountId;

              return {
                accountId,
                signedMinor: control.independentOpeningMinor,
                basis: control.basis,
              };
            });

            const basisControls = yield* Effect.forEach(controls, (control) =>
              control.accountId
                ? Effect.succeed({ ...control, accountId: control.accountId })
                : failure("InvalidJournal"),
            );

            yield* selectBasisInTransaction(tx, principal, scope, {
              fiscalYearId: year.id,
              mode: "full_history",
              cutoverOn: dates.historyStartsOn,
              sourcePlanId: plan.id,
              sourceDigest: plan.digest,
              changeSetId: null,
              controls: basisControls,
              rationale: "Retained independent opening establishes the historical import basis",
            });

            const financialRun = yield* startFinancialRunInTransaction(tx, principal, {
              scope,
              id: sourceRun.id,
              idempotencyKey: `${idempotencyKey}_financial`,
              fiscalYearId: year.id,
              planDigest: plan.digest,
            });

            const staged = (yield* SourceDb.readRun(tx, scope.bookId, sourceRun.id))[0];

            if (!staged) return yield* failure("InternalError");

            const result = yield* decode(O.OnboardingImportStart, {
              plan,
              financialRun,
              sourceRun: { ...staged, planDigest: plan.digest, financialAdmission: "unsupported" },
            });

            return result;
          }),
        );
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});
