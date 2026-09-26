import * as Accounting from "@open-erp/contracts/accounting";
import * as Payroll from "@open-erp/contracts/payroll-calculations";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { newId, replay, saveCommand, versionedDigest } from "../posting";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import type { Dates } from "../company-profile-basis";
import {
  decode,
  requireRetainedEvidence,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { readTableAccess } from "../../db/commerce/access";
import * as Ledger from "../../db/posting";
import * as ProfileDb from "../../db/company-profiles";
import * as PayrollFoundationDb from "../../db/payroll-foundation";
import * as Db from "../../db/payroll/calculations";
import type { Transaction } from "../../db/transaction";
import { calculateRegularPayroll } from "./calculation-basis";

// A frozen regular-payroll calculation. It posts no journal, pays no salary,
// makes no declaration and reserves no monthly contribution capacity; execution
// and payment belong to the next named operations' own group.
//
// Lock order: requester credential and membership, then the book writer row, then
// the 9050/9107 revision heads, then the payroll calculation rows. The sealed
// proposal, the frozen calculation and the retained input references commit
// together or not at all.

const readTables = [
  ...Db.payrollCalculationTables,
  "change_sets",
  "payroll_revisions",
  "payroll_current_revisions",
  "payroll_employees",
  "rule_releases",
  "company_family_memberships",
] as const;

const writeTables = [...Db.payrollCalculationTables, "change_sets"] as const;

const commandOperation = "prepare_payroll_calculation";

const OpeningBody = Schema.Struct({
  asOf: Accounting.AccountingDate,
  balanceMinor: Accounting.SignedMinorUnits,
  obligation: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
});

const WorkBody = Schema.Struct({
  periodStart: Accounting.AccountingDate,
  periodEnd: Accounting.AccountingDate,
  inputs: Schema.Array(Schema.Unknown).check(Schema.isMinLength(1)),
});

function requireTableGrants(transaction: Transaction, write: boolean) {
  const names = write ? [...writeTables] : [...readTables];

  return readTableAccess(transaction, names).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== names.length) return failure("UnsupportedProfile");

      if (rows.some((row) => !row.canSelect)) return failure("UnsupportedProfile");

      return write && rows.some((row) => !row.canInsert)
        ? failure("UnsupportedProfile")
        : Effect.void;
    }),
  );
}

// Private payroll access stays its own grant. A book membership is not payroll
// authority, and a cached permission is not either.
function requirePayrollGrant(transaction: Transaction, scope: Scope, actorId: string) {
  return PayrollFoundationDb.readPayrollAccess(transaction, scope.bookId, actorId).pipe(
    Effect.flatMap((rows) => (rows.length === 0 ? failure("Forbidden") : Effect.void)),
  );
}

// The payroll family selects its reviewed configuration on the planned payment
// date, never on today's date.
function profileDates(paymentOn: string): Dates {
  return { postingOn: null, taxPointOn: null, paymentOn, reportOn: null };
}

function evidenceReferences(input: typeof Payroll.PreparePayRun.Type) {
  const employment = input.employment;
  const work = input.work;

  const rows = [
    ...employment.withholding.evidence,
    ...work.evidence,
    ...[...employment.grossAdjustments, ...work.adjustments].flatMap((row) => [...row.evidence]),
    ...[...employment.reimbursements, ...work.reimbursements].map((row) => row.evidence),
  ];

  for (const obligation of [employment.holidayPolicy, ...employment.pensionAndOtherObligations]) {
    if (obligation.state === "applicable") rows.push(...obligation.selection.evidence);

    if (obligation.state === "evidenced_not_applicable") rows.push(...obligation.evidence);
  }

  return rows;
}

// The retained exact input references. A later employment, work, opening or
// release change makes a new execution require a new calculation; it never
// rewrites these.
function basisInputRefs(
  basis: typeof Payroll.PayrollCalculationBasis.Type,
  releaseId: string,
  releaseChecksum: string,
  calculatorVersion: string,
) {
  return [
    {
      kind: "employment_revision",
      resourceId: basis.employmentRevisionId,
      version: basis.employmentRevisionId,
      reason: "Exact current employment revision this calculation binds to",
    },
    {
      kind: "work_revision",
      resourceId: basis.workRevisionId,
      version: basis.workRevisionId,
      reason: "Exact current work revision this calculation binds to",
    },
    {
      kind: "opening_revision",
      resourceId: basis.openingRevisionId,
      version: basis.openingRevisionId,
      reason: "Exact retained opening balance supplying the prior monthly base",
    },
    {
      kind: "rule_release",
      resourceId: releaseId,
      version: releaseChecksum,
      reason: `Reviewed payroll rule release for calculator ${calculatorVersion}`,
    },
    ...basis.priorFrozenCalculationIds.map((id) => ({
      kind: "prior_frozen_calculation" as const,
      resourceId: id,
      version: id,
      reason: "Frozen same-month contribution base already reserved by this owner",
    })),
    ...(basis.companyActivationId === null
      ? []
      : [
          {
            kind: "company_activation" as const,
            resourceId: basis.companyActivationId,
            version: basis.companyActivationId,
            reason: "Payroll family admission activation current on the payment date",
          },
        ]),
    ...basis.factRevisionIds.map((id) => ({
      kind: "company_fact_revision" as const,
      resourceId: id,
      version: id,
      reason: "Exact reviewed company fact revision",
    })),
    ...basis.factReviewIds.map((id) => ({
      kind: "company_fact_review" as const,
      resourceId: id,
      version: id,
      reason: "Independent review of that fact revision",
    })),
    ...basis.roleBindingIds.map((id) => ({
      kind: "company_role_binding" as const,
      resourceId: id,
      version: id,
      reason: "Exact reviewed account role binding",
    })),
    ...basis.evidenceIds.map((id) => ({
      kind: "evidence" as const,
      resourceId: id,
      version: id,
      reason: "Retained evidence backing a reviewed calculation input",
    })),
  ] satisfies ReadonlyArray<typeof Payroll.PayrollCalculationInputRef.Type>;
}

export const prepareCalculation = Effect.fn("payroll.prepareCalculation")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Payroll.PreparePayRun.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const input = yield* toJsonObject(command.input);

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        commandOperation,
        principal.actorId,
        input,
        Payroll.PayrollCalculation,
      );

      // A committed identical command returns before any new-work, capacity or
      // duplicate-economics work.
      if (request.previous) return request.previous;

      yield* requireTableGrants(transaction, true);
      yield* requirePayrollGrant(transaction, command.scope, principal.actorId);

      const prepared = yield* decode(Payroll.PreparePayRun, input);
      const employeeId = prepared.employment.employeeId;
      const period = prepared.work.earningsPeriod;
      const paymentOn = prepared.work.expectedPaymentOn;
      const book = (yield* Ledger.readBook(transaction, command.scope))[0];

      if (!book) return yield* failure("Forbidden");

      const resolved = yield* resolveCompanyProfileInTransaction(
        transaction,
        command.scope,
        prepared.recordClass,
        profileDates(paymentOn),
      );

      const witness = resolved.families.find((entry) => entry.family === "payroll")?.witness;

      // A missing, ambiguous, unreviewed or inapplicable release is refused. It
      // is never replaced by a default rate, table or band.
      if (!witness) return yield* failure("UnsupportedProfile");

      const releaseRow = (yield* Db.readRuleRelease(transaction, witness.ruleReleaseId))[0];

      if (!releaseRow || releaseRow.family !== "payroll") {
        return yield* failure("UnsupportedProfile");
      }

      const release = Option.getOrNull(
        Schema.decodeUnknownOption(Payroll.PayrollRuleRelease)(releaseRow.body),
      );

      if (release === null) return yield* failure("UnsupportedProfile");

      if (release.calculatorVersion !== Payroll.SupportedCalculatorVersion) {
        return yield* failure("UnsupportedProfile");
      }

      // One original regular earning event per employee and earnings period. A
      // new work revision needs a correction, never a second salary event.
      if (
        (yield* Db.readEarningEvent(
          transaction,
          command.scope.bookId,
          employeeId,
          period.startsOn,
          period.endsOn,
        )).length > 0
      ) {
        return yield* failure("IdempotencyConflict");
      }

      const employment = (yield* Db.lockRevisionHead(
        transaction,
        command.scope.bookId,
        employeeId,
        "employment",
        period.startsOn,
      ))[0];

      const work = (yield* Db.lockRevisionHead(
        transaction,
        command.scope.bookId,
        employeeId,
        "work",
        period.startsOn,
      ))[0];

      const opening = (yield* Db.lockRevisionHead(
        transaction,
        command.scope.bookId,
        employeeId,
        "opening",
        period.startsOn,
      ))[0];

      if (!employment || !work || !opening) return yield* failure("NotFound");

      if (
        employment.id !== prepared.employment.effectiveRevision ||
        work.id !== prepared.work.effectiveRevision
      ) {
        return yield* failure("StaleDependency");
      }

      // A revision is a live fact only while the current pointer still names it.
      for (const [kind, row] of [
        ["employment", employment],
        ["work", work],
        ["opening", opening],
      ] as const) {
        const current = yield* Db.readCurrentRevisionAt(
          transaction,
          command.scope.bookId,
          employeeId,
          kind,
          row.effectiveOn,
          "update",
        );

        if (current[0]?.revisionId !== row.id) return yield* failure("StaleDependency");
      }

      const workBody = yield* decode(WorkBody, work.body);
      const openingBody = yield* decode(OpeningBody, opening.body);

      if (workBody.periodStart !== period.startsOn || workBody.periodEnd !== period.endsOn) {
        return yield* failure("StaleDependency");
      }

      if (openingBody.asOf > period.startsOn) return yield* failure("UnsupportedProfile");

      if (BigInt(openingBody.balanceMinor) < 0n) return yield* failure("InvalidJournal");

      for (const reference of evidenceReferences(prepared)) {
        yield* requireRetainedEvidence(transaction, command.scope.bookId, reference);
      }

      // A second frozen calculation in the same calendar month would be granted
      // the same reduced contribution band twice, so the reserved part of the
      // prior base is the contribution base already frozen by this owner. A
      // reservation from an executed run is the execution owner's record and is
      // not observable from here.
      const frozen = yield* Db.readSameMonthContributions(
        transaction,
        command.scope.bookId,
        employeeId,
        period.startsOn.slice(0, 7),
      );

      const membership = yield* ProfileDb.readFamilyMembership(
        transaction,
        command.scope.bookId,
        "payroll",
      );

      const basis = yield* decode(
        Payroll.PayrollCalculationBasis,
        yield* toJsonObject({
          employeeId,
          employmentRevisionId: employment.id,
          workRevisionId: work.id,
          openingRevisionId: opening.id,
          priorFrozenCalculationIds: frozen.map((row) => row.id),
          openingBaseMinor: openingBody.balanceMinor,
          priorFrozenBaseMinor: frozen
            .reduce((total, row) => total + BigInt(row.contributionBaseMinor), 0n)
            .toString(),
          earningsPeriod: period,
          expectedPaymentOn: paymentOn,
          currency: book.currency,
          currencyScale: book.currencyScale,
          ruleReleaseId: releaseRow.id,
          ruleReleaseChecksum: releaseRow.checksum,
          ruleReleaseVersion: releaseRow.version,
          companyActivationId: witness.activationId,
          familyMembershipEpoch: membership[0]?.membershipEpoch.toString() ?? null,
          factRevisionIds: witness.factRevisionIds,
          factReviewIds: witness.factReviewIds,
          roleBindingIds: witness.roleBindingIds,
          evidenceIds: [employment.evidenceId, work.evidenceId, opening.evidenceId],
          calculatorVersion: release.calculatorVersion,
          sourceCoverage: "complete",
          reviewedInput: prepared,
        }),
      );

      // Pure. No database access, no HTTP, no provider call, no human wait.
      const calculated = yield* calculateRegularPayroll(basis, release);

      const calculationId = newId("paycalc");
      const planId = newId("payplan");
      const now = yield* Ledger.readDatabaseTime(transaction);
      const recordedAt = new Date(now.now).toISOString();

      const inputRefs = basisInputRefs(
        basis,
        releaseRow.id,
        releaseRow.checksum,
        release.calculatorVersion,
      );

      const sealed = yield* versionedDigest(
        yield* toJsonObject({
          schemaVersion: 1,
          canonicalization: "openerp-c14n-v1",
          owner: "payroll_calculation",
          id: calculationId,
          scope: command.scope,
          planId,
          version: 1,
          basis,
          calculation: calculated,
          createdBy: principal.actorId,
          createdAt: recordedAt,
        }),
      );

      const result = yield* decode(
        Payroll.PayrollCalculation,
        yield* toJsonObject({
          id: calculationId,
          scope: command.scope,
          employeeId,
          changeSetId: planId,
          planDigest: sealed,
          basis,
          calculation: calculated,
          inputRefs,
          noFinancialEffect: true,
          createdBy: principal.actorId,
          createdAt: recordedAt,
          receipt: {
            key: command.idempotencyKey,
            operation: commandOperation,
            actorId: principal.actorId,
          },
        }),
      );

      const row = yield* toJsonObject(result);

      yield* Ledger.insertPlan(transaction, {
        bookId: command.scope.bookId,
        id: planId,
        plan: row,
        digest: sealed,
        createdBy: principal.actorId,
      });

      yield* Db.insertCalculation(transaction, {
        bookId: command.scope.bookId,
        id: calculationId,
        employeeId,
        changeSetId: planId,
        planDigest: sealed,
        ruleReleaseId: releaseRow.id,
        earningsPeriodStart: period.startsOn,
        earningsPeriodEnd: period.endsOn,
        expectedPaymentOn: paymentOn,
        grossMinor: calculated.grossMinor,
        withholdingMinor: calculated.withholdingMinor,
        netDeductionMinor: calculated.netDeductionMinor,
        contributionBaseMinor: calculated.contributionBaseMinor,
        employerContributionMinor: calculated.employerContributionMinor,
        payableMinor: calculated.payableMinor,
        noFinancialEffect: true,
        body: row,
        createdBy: principal.actorId,
        createdAt: recordedAt,
      });

      yield* Db.insertInputRefs(
        transaction,
        inputRefs.map((reference, index) => ({
          bookId: command.scope.bookId,
          calculationId,
          ordinal: index + 1,
          kind: reference.kind,
          resourceId: reference.resourceId,
          version: reference.version,
          reason: reference.reason,
        })),
      );

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        commandOperation,
        principal.actorId,
        row,
      );

      return result;
    },
    "update",
  );
});

function calculationView(row: Db.CalculationRow, refs: ReadonlyArray<Db.InputRefRow>) {
  return toJsonObject(row.body).pipe(
    Effect.flatMap((body) =>
      decode(Payroll.PayrollCalculation, {
        ...body,
        inputRefs: refs
          .filter((reference) => reference.calculationId === row.id)
          .map((reference) => ({
            kind: reference.kind,
            resourceId: reference.resourceId,
            version: reference.version,
            reason: reference.reason,
          })),
      }),
    ),
  );
}

export const getCalculation = Effect.fn("payroll.getCalculation")(function* (
  token: string,
  command: { scope: Scope; calculationId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableGrants(transaction, false);

    const row = (yield* Db.readCalculation(
      transaction,
      command.scope.bookId,
      command.calculationId,
    ))[0];

    if (!row) return yield* failure("NotFound");

    const refs = yield* Db.readInputRefs(transaction, command.scope.bookId, [row.id]);

    return yield* calculationView(row, refs);
  });
});

export const listCalculations = Effect.fn("payroll.listCalculations")(function* (
  token: string,
  command: { scope: Scope; employeeId: string; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireTableGrants(transaction, false);

    const rows = yield* Db.readCalculationsAfter(
      transaction,
      command.scope.bookId,
      command.employeeId,
      command.after ?? "",
    );

    const page = rows.slice(0, 20);

    const refs =
      page.length === 0
        ? []
        : yield* Db.readInputRefs(
            transaction,
            command.scope.bookId,
            page.map((row) => row.id),
          );

    const items = yield* Effect.forEach(page, (row) => calculationView(row, refs));

    return yield* decode(Payroll.PayrollCalculationPage, {
      scope: command.scope,
      employeeId: command.employeeId,
      items,
      next: rows.length > page.length ? (page.at(-1)?.id ?? null) : null,
    });
  });
});
