import { runBookCommand } from "../book-commands";
import { requireResolvedImportReview } from "./import-review";
import { openingInvoiceDetails } from "./open-items";
import * as Mapping from "@open-erp/contracts/onboarding-mappings";
import * as MappingDb from "../../db/onboarding-mappings";
import * as Ledger from "../../db/posting";
import * as O from "@open-erp/contracts/onboarding";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Cases from "../../db/onboarding";
import * as LifecycleDb from "../../db/onboarding-lifecycle";
import * as SourceDb from "../../db/sie-import";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { withAdmittedPrincipal } from "../identity";

import { readSourceOccurrenceInTransaction } from "../source-retention";
import { sealSourcePlanInTransaction } from "../sie/import";

function qualifiedBalance(tx: Transaction, scope: Scope, id: string, asOf: string) {
  return Effect.gen(function* () {
    const records = yield* LifecycleDb.readRecords(tx, "controls", scope.bookId);

    if (records.length > 1000) return yield* failure("UnsupportedProfile");
    const controls = yield* Effect.forEach(records, (row) => decode(O.OnboardingControl, row.body));

    if (!controls.some((control) => control.id === id)) return yield* failure("NotFound");

    const latest = controls
      .filter((control) => control.kind === "trial_balance" && control.asOf === asOf)
      .toSorted(
        (left, right) =>
          right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
      )[0];

    if (!latest || latest.id !== id || latest.currency !== "SEK")
      return yield* failure("StaleDependency");

    const snapshots = yield* Effect.forEach(
      yield* LifecycleDb.readRecords(tx, "snapshots", scope.bookId),
      (row) => decode(O.OnboardingSnapshot, row.body),
    );

    const decisions = yield* Effect.forEach(
      yield* LifecycleDb.readRecords(tx, "decisions", scope.bookId),
      (row) => decode(O.OnboardingDecision, row.body),
    );

    if (
      snapshots.some(
        (snapshot) =>
          snapshot.controlIds.includes(id) &&
          decisions.some(
            (decision) =>
              decision.snapshotId === snapshot.id && decision.decision.kind === "reject",
          ),
      )
    )
      return yield* failure("ApprovalRequired");

    return latest;
  });
}

function reviewedMappings(
  tx: Transaction,
  scope: Scope,
  preview: typeof Sie.SiePreview.Type,
  original: { sourceSystem: string; sourceAccountId: string },
  mappings: typeof O.PrepareOnboardingImportPlan.Type.mappings,
) {
  return Effect.gen(function* () {
    const rows = yield* MappingDb.readMappingHistory(
      tx,
      scope.bookId,
      original.sourceSystem,
      original.sourceAccountId,
    );

    if (rows.length > 1000) return yield* failure("UnsupportedProfile");

    const choices = yield* Effect.forEach(rows, (row) =>
      decode(Mapping.OnboardingMapping, row.body),
    );

    const accounts = yield* Ledger.readAccounts(
      tx,
      scope.bookId,
      mappings.map((mapping) => mapping.accountId),
    );

    for (const mapping of mappings) {
      const account = accounts.find((entry) => entry.id === mapping.accountId && entry.active);

      if (!account) return yield* failure("AccountInactive");
      const choice = choices.find((entry) => entry.sourceAccount === mapping.sourceAccount);

      if (choice?.previewId === preview.id && choice.previewDigest === preview.digest) {
        if (choice.accountId !== account.id) return yield* failure("StaleDependency");
      } else if (account.code !== mapping.sourceAccount) return yield* failure("ApprovalRequired");
    }
  });
}

function independentControls(
  preview: typeof Sie.SiePreview.Type,
  opening: typeof O.OnboardingControl.Type,
  closing: typeof O.OnboardingControl.Type,
  mappings: typeof O.PrepareOnboardingImportPlan.Type.mappings,
) {
  return Effect.gen(function* () {
    const controls: Array<typeof Sie.OpeningControl.Type> = [];

    for (const source of preview.controls.filter((control) => control.kind === "IB")) {
      if (source.year !== "0") return yield* failure("UnsupportedProfile");
      const mapping = mappings.find((entry) => entry.sourceAccount === source.account);
      const before = opening.facts.filter((fact) => fact.accountId === mapping?.accountId);
      const after = closing.facts.filter((fact) => fact.accountId === mapping?.accountId);

      if (!mapping || before.length === 0 || after.length === 0)
        return yield* failure("MissingEvidence");
      controls.push({
        sourceAccount: source.account,
        year: source.year,
        independentOpeningMinor: before
          .reduce((total, fact) => total + BigInt(fact.amountMinor), 0n)
          .toString(),
        independentClosingMinor: after
          .reduce((total, fact) => total + BigInt(fact.amountMinor), 0n)
          .toString(),
        basis: `Independent retained controls ${opening.id}, ${closing.id}`,
      });
    }

    return controls;
  });
}

export const prepareOnboardingImportPlan = Effect.fn("onboarding.import.preparePlan")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof O.PrepareOnboardingImportPlan.Type;
  },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const { input, scope, idempotencyKey } = command;
        const operation = "prepare_onboarding_import_plan";

        return yield* runBookCommand(
          tx,
          {
            scope: scope,
            idempotencyKey: idempotencyKey,
            operation: operation,
            actorId: principal.actorId,
            input: input,
          },
          Sie.SiePlan,
          Effect.gen(function* () {
            const configuration = (yield* Cases.readCurrent(tx, scope.bookId))[0];
            const record = (yield* SourceDb.readPreview(tx, scope.bookId, input.previewId))[0];

            if (!configuration || !record) return yield* failure("NotFound");
            const current = yield* decode(O.OnboardingCase, configuration.body);
            const preview = yield* decode(Sie.SiePreview, record.body);
            yield* requireResolvedImportReview(tx, scope, preview.id);
            const dates = current.configuration.dates;

            if (
              current.revision !== input.expectedRevision ||
              !dates.historyStartsOn ||
              !dates.historyEndsOn ||
              !dates.candidateLiveOn ||
              dates.historyEndsOn >= dates.candidateLiveOn ||
              current.configuration.migrationDepth !== "current_fiscal_year"
            )
              return yield* failure("StaleDependency");

            const currencies = preview.records.filter((row) => row.tag === "VALUTA");

            if (currencies.some((row) => row.fields.length !== 1 || row.fields[0] !== "SEK"))
              return yield* failure("UnsupportedProfile");

            const fiscalYear = preview.records.find(
              (row) => row.tag === "RAR" && row.fields[0] === "0",
            );

            if (fiscalYear?.fields[1] !== dates.historyStartsOn.replaceAll("-", ""))
              return yield* failure("UnsupportedProfile");

            if (preview.digest !== input.expectedPreviewDigest || !preview.ready)
              return yield* failure("StaleDependency");

            if (
              new Set(preview.vouchers.map((voucher) => voucher.sourceReference)).size !==
              preview.vouchers.length
            )
              return yield* failure("InvalidJournal");

            for (const voucher of preview.vouchers) {
              const date = `${voucher.date.slice(0, 4)}-${voucher.date.slice(4, 6)}-${voucher.date.slice(6, 8)}`;

              if (
                date < dates.historyStartsOn ||
                date > dates.historyEndsOn ||
                date >= dates.candidateLiveOn
              )
                return yield* failure("UnsupportedProfile");
            }

            const original = yield* readSourceOccurrenceInTransaction(
              tx,
              scope,
              preview.occurrenceId,
            );

            if (
              (yield* Cases.readLinkedSource(tx, scope.bookId, {
                occurrenceId: preview.occurrenceId,
                category: "previous_books",
              })).length === 0
            )
              return yield* failure("MissingEvidence");

            yield* reviewedMappings(tx, scope, preview, original, input.mappings);

            const openingOn = new Date(
              Date.parse(`${dates.historyStartsOn}T00:00:00Z`) - 86_400_000,
            )
              .toISOString()
              .slice(0, 10);

            const opening = yield* qualifiedBalance(tx, scope, input.openingControlId, openingOn);

            const closing = yield* qualifiedBalance(
              tx,
              scope,
              input.closingControlId,
              dates.historyEndsOn,
            );

            const result = yield* sealSourcePlanInTransaction(tx, principal, {
              scope,
              id: preview.id,
              idempotencyKey: `${idempotencyKey}_sourceplan`,
              input: {
                digest: preview.digest,
                mappings: input.mappings,
                openingControls: yield* independentControls(
                  preview,
                  opening,
                  closing,
                  input.mappings,
                ),
                ...(yield* openingInvoiceDetails(tx, scope, dates.openingOn, input.mappings)),
                rationale: input.rationale,
                openingPolicy: "unreconstructable_detail",
                sourceKind: original.sourceSystem.startsWith("synthetic_")
                  ? "synthetic"
                  : "reviewed_sie4",
              },
            });

            return result;
          }),
        );
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});
