import { type Scope } from "./posting-approval";

import { equalJson } from "@open-erp/domain/canonicalization";

import * as Accounting from "@open-erp/contracts/accounting";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as ProfileDb from "../db/company-profiles";
import { versionedDigest } from "./json";
import { resolveCompanyProfileInTransaction } from "./company-profiles";

import { ManualCompanyAdmission } from "@open-erp/domain/ledger";
import { orderPostingGroups, validatePostingLines } from "@open-erp/domain/posting";

import * as Effect from "effect/Effect";

import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure, postingFailure } from "./failures";

import * as Db from "../db/posting";

import { type Transaction } from "../db/transaction";

export type Plan = typeof Accounting.ChangeSet.Type;

export type Action = typeof Accounting.VoucherPostingAction.Type;

type JsonObject = Schema.JsonObject;

export const VoucherSchema = Accounting.Voucher;

export const ActionSchema = Accounting.VoucherPostingAction;

export const manualJournalContext = Object.freeze({ kind: "public_manual_journal" as const });

export type ManualContext = typeof manualJournalContext;

const legalPostingPurposes: ReadonlyArray<string> = [
  "legal_ar_recognition",
  "legal_customer_credit_v1",
];

const transferPostingPurposes: ReadonlyArray<string> = ["result_transfer_v1"];

export function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(
    Effect.mapError((cause) => failure("InternalError", cause)),
  );
}

export function voucherFromRow(row: Db.VoucherRow) {
  return {
    id: row.id,
    number: row.number.toString(),
    sequence: row.sequence.toString(),
    recordedAt: row.recordedAt,
    action: row.action,
  };
}

export function readVoucher(transaction: Transaction, scope: Scope, voucherId: string) {
  return Db.readVoucher(transaction, scope.bookId, voucherId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      if (!row) return failure("NotFound");

      return decode(VoucherSchema, voucherFromRow(row));
    }),
  );
}

export function readBook(transaction: Transaction, scope: Scope) {
  return Db.readBook(transaction, scope).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      if (!row) return failure("Forbidden");

      return Effect.succeed(row);
    }),
  );
}

export function readPeriod(transaction: Transaction, scope: Scope, periodId: string) {
  return Db.readPeriod(transaction, scope.bookId, periodId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      if (!row) return failure("AccountingPeriodMissing");

      return readFiscalYear(transaction, scope, row.fiscalYearId).pipe(
        Effect.flatMap((fiscalYearRows) => {
          const fiscalYear = fiscalYearRows[0];

          if (!fiscalYear) return failure("AccountingPeriodMissing");

          return Effect.succeed({ ...row, fiscalYear });
        }),
      );
    }),
  );
}

function readFiscalYear(transaction: Transaction, scope: Scope, fiscalYearId: string) {
  return Db.readFiscalYear(transaction, scope.bookId, fiscalYearId);
}

function validateReversalAction(transaction: Transaction, scope: Scope, action: Action) {
  return Effect.gen(function* () {
    if (!action.correctsVoucherId) return yield* failure("InvalidJournal");
    const original = yield* readVoucher(transaction, scope, action.correctsVoucherId);

    if (original.action.postingPurpose === "reversal") return yield* failure("InvalidJournal");

    if (original.action.kind !== "post_voucher") return yield* failure("InvalidJournal");

    if (original.action.lines.length !== action.lines.length)
      return yield* failure("InvalidJournal");

    if (original.action.eventId !== action.eventId) return yield* failure("InvalidJournal");

    if (JSON.stringify(original.action.evidenceRefs) !== JSON.stringify(action.evidenceRefs)) {
      return yield* failure("InvalidJournal");
    }

    if (action.occurrenceKey !== action.correctsVoucherId) return yield* failure("InvalidJournal");

    for (const [index, line] of action.lines.entries()) {
      const originalLine = original.action.lines[index];

      if (
        !originalLine ||
        line.accountId !== originalLine.accountId ||
        line.debitMinor !== originalLine.creditMinor ||
        line.creditMinor !== originalLine.debitMinor
      ) {
        return yield* failure("InvalidJournal");
      }
    }
  });
}

export function isCompanyManualAction(action: Action) {
  return (
    action.manualCompanyAdmission !== undefined &&
    action.kind === "post_voucher" &&
    action.postingPurpose === "adjustment" &&
    action.correctsVoucherId === null &&
    action.occurrenceKey === "manual_journal" &&
    action.taxAssessment === "not_applicable" &&
    action.vatReclassification === undefined &&
    !["legalIssue", "legalCredit", "resultTransfer", "assetProceeds", "foreignCurrency"].some(
      (name) => name in action,
    ) &&
    action.manualCompanyAdmission.witness.selectorDate === action.postingDate
  );
}

export const readManualAdmission = Effect.fn("posting.readManualAdmission")(function* (
  transaction: Transaction,
  scope: Scope,
  book: { currency: string },
  postingOn: string,
  code: "UnsupportedProfile" | "StaleDependency",
) {
  if (!Accounting.isCalendarDate(postingOn)) return yield* failure(code);

  const resolved = yield* resolveCompanyProfileInTransaction(transaction, scope, "actual_company", {
    postingOn,
    taxPointOn: null,
    paymentOn: null,
    reportOn: null,
    taxPeriodOn: null,
  });

  const witness = resolved.families.find(
    (family) => family.family === "posting_eligibility",
  )?.witness;

  if (!witness || witness.activationId === null) return yield* failure(code);

  const row = (yield* ProfileDb.readRuleReleases(transaction, "posting_eligibility")).find(
    (entry) => entry.id === witness.ruleReleaseId && entry.checksum === witness.ruleReleaseChecksum,
  );

  if (!row) return yield* failure(code);

  const release = yield* Schema.decodeUnknownEffect(Profiles.RuleRelease)(row.body).pipe(
    Effect.mapError(() => failure(code)),
  );

  if (
    release.calculatorVersion !== "manual-journal-v1" ||
    !release.requiredFactKinds.includes("accounting_method") ||
    !release.requiredFactKinds.includes("base_currency") ||
    release.applicability.accountingMethods.length === 0 ||
    !release.applicability.baseCurrencies?.includes(book.currency)
  )
    return yield* failure(code);

  const currentFacts = yield* ProfileDb.readFactRevisions(
    transaction,
    scope.entityId,
    postingOn,
    postingOn,
  );

  if (
    currentFacts.some(
      (fact) => fact.supersedesId !== null && witness.factRevisionIds.includes(fact.supersedesId),
    )
  )
    return yield* failure(code);

  const currencyRow = currentFacts.find(
    (fact) => fact.factKind === "base_currency" && witness.factRevisionIds.includes(fact.id),
  );

  if (!currencyRow) return yield* failure(code);

  const currency = yield* Schema.decodeUnknownEffect(Profiles.FactRevision)(currencyRow.body).pipe(
    Effect.mapError(() => failure(code)),
  );

  if (
    currency.factKind !== "base_currency" ||
    currency.value.state !== "known" ||
    currency.value.value !== book.currency
  )
    return yield* failure(code);

  const membership = (yield* ProfileDb.readFamilyMembership(
    transaction,
    scope.bookId,
    "posting_eligibility",
  ))[0];

  if (!membership) return yield* failure(code);

  return yield* Schema.decodeUnknownEffect(ManualCompanyAdmission)({
    witness,
    membershipEpoch: membership.membershipEpoch.toString(),
  }).pipe(Effect.mapError(() => failure(code)));
});

function supportsPostingProfile(
  book: { currency: string; profile: string },
  action: Action,
  manualContext?: ManualContext,
) {
  if (action.currency !== book.currency) return false;

  if (action.manualCompanyAdmission !== undefined) {
    return (
      manualContext === manualJournalContext &&
      book.profile === "company-setup-v1" &&
      isCompanyManualAction(action)
    );
  }

  return book.profile === "synthetic-core-v1";
}

export function validateActionWithContext(
  transaction: Transaction,
  scope: Scope,
  book: { currency: string; profile: string; authority: string },
  action: Action,
  allowLegal = false,
  allowTransfer = false,
  allowAsset = false,
  manualContext?: ManualContext,
) {
  return Effect.gen(function* () {
    const lines = validatePostingLines(action.lines);

    if (Result.isFailure(lines)) return yield* postingFailure(lines.failure.code);

    if (!supportsPostingProfile(book, action, manualContext)) {
      return yield* failure("UnsupportedProfile");
    }

    if (book.authority !== "native") return yield* failure("StaleDependency");

    const period = yield* readPeriod(transaction, scope, action.accountingPeriodId);

    if (period.locked) return yield* failure("PeriodLocked");

    if (
      period.fiscalYearId !== action.fiscalYearId ||
      action.postingDate < period.startsOn ||
      action.postingDate > period.endsOn ||
      action.postingDate < period.fiscalYear.startsOn ||
      action.postingDate > period.fiscalYear.endsOn
    ) {
      return yield* failure("PostingDateOutsidePeriod");
    }

    const accountRows = yield* Db.readAccounts(
      transaction,
      scope.bookId,
      action.lines.map((line) => line.accountId),
    );

    if (accountRows.length !== new Set(action.lines.map((line) => line.accountId)).size) {
      return yield* failure("AccountMissing");
    }

    if (action.postingPurpose !== "reversal" && accountRows.some((account) => !account.active)) {
      return yield* failure("AccountInactive");
    }

    const eventRows = yield* Db.readEventById(transaction, scope.bookId, action.eventId);

    if (eventRows.length !== 1) return yield* failure("InvalidJournal");

    for (const reference of action.evidenceRefs) {
      const evidenceRows = yield* Db.readEvidence(transaction, scope.bookId, reference.evidenceId);

      if (evidenceRows[0]?.sha256 !== reference.sha256) return yield* failure("MissingEvidence");
    }

    if (action.postingPurpose === "reversal") {
      yield* validateReversalAction(transaction, scope, action);
    } else if (
      (action.postingPurpose !== "adjustment" &&
        !(allowLegal && legalPostingPurposes.includes(action.postingPurpose)) &&
        !(allowTransfer && transferPostingPurposes.includes(action.postingPurpose)) &&
        !(allowAsset && action.postingPurpose === "asset_proceeds_disposal_v1")) ||
      action.correctsVoucherId !== null
    ) {
      return yield* failure("InvalidJournal");
    }
  });
}

export function validatePlanWithContext(
  transaction: Transaction,
  scope: Scope,
  plan: Plan,
  allowLegal = false,
  allowTransfer = false,
  allowAsset = false,
  manualContext?: ManualContext,
) {
  return Effect.gen(function* () {
    const planWithoutDigest = Object.fromEntries(
      Object.entries(plan).filter(([key]) => key !== "planDigest"),
    );

    const sealedDigest = yield* versionedDigest(planWithoutDigest, "StaleDependency");

    if (sealedDigest !== plan.planDigest) return yield* failure("StaleDependency");

    const groups = orderPostingGroups(
      plan.groups.map((group) => ({ id: group.id, dependsOnGroupIds: group.dependsOnGroupIds })),
    );

    if (Result.isFailure(groups)) return yield* failure("InvalidJournal");
    const book = yield* readBook(transaction, scope);

    if (manualContext === manualJournalContext) {
      const action = plan.groups[0]?.actions[0];

      if (
        plan.groups.length !== 1 ||
        plan.groups[0]?.actions.length !== 1 ||
        !action ||
        !isCompanyManualAction(action)
      )
        return yield* failure("UnsupportedProfile");

      const current = yield* readManualAdmission(
        transaction,
        scope,
        book,
        action.postingDate,
        "StaleDependency",
      );

      if (!equalJson(action.manualCompanyAdmission, current))
        return yield* failure("StaleDependency");
    }

    const accountVersions = new Map(
      (yield* Db.readAccounts(
        transaction,
        scope.bookId,
        plan.dependencies.flatMap((dependency) =>
          dependency.kind === "account" ? [dependency.resourceId] : [],
        ),
      )).map((account) => [account.id, account.version.toString()]),
    );

    for (const dependency of plan.dependencies) {
      let currentVersion: string | undefined;

      if (dependency.kind === "profile") currentVersion = book.profileVersion.toString();

      if (dependency.kind === "writer_epoch") currentVersion = book.writerEpoch.toString();

      if (dependency.kind === "period") {
        const periodRows = yield* Db.readPeriod(transaction, scope.bookId, dependency.resourceId);
        currentVersion = periodRows[0]?.version.toString();
      }

      if (dependency.kind === "account") {
        currentVersion = accountVersions.get(dependency.resourceId);
      }

      if (currentVersion !== dependency.version) return yield* failure("StaleDependency");
    }

    const groupsById = new Map(plan.groups.map((group) => [group.id, group]));

    for (const group of groups.success) {
      const storedGroup = groupsById.get(group.id);

      if (!storedGroup) return yield* failure("InvalidJournal");

      for (const action of storedGroup.actions) {
        const decodedAction = yield* decode(ActionSchema, action);
        yield* validateActionWithContext(
          transaction,
          scope,
          book,
          decodedAction,
          allowLegal,
          allowTransfer,
          allowAsset,
          manualContext,
        );
      }
    }
  });
}

export function validatePlan(
  transaction: Transaction,
  scope: Scope,
  plan: Plan,
  allowLegal = false,
  allowTransfer = false,
  allowAsset = false,
) {
  return validatePlanWithContext(transaction, scope, plan, allowLegal, allowTransfer, allowAsset);
}
