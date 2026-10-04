import * as Accounting from "@open-erp/contracts/accounting";
import * as Payroll from "@open-erp/contracts/payroll-calculations";
import * as Profiles from "@open-erp/contracts/company-profiles";
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

// Bounded immutable revisions of one earning event.
const maximumRevisions = 1000;

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

// A monthly pay event covers one whole calendar month. The last day is derived
// from the calendar rather than assumed, so a month boundary is exact.
function isWholeCalendarMonth(period: { startsOn: string; endsOn: string }) {
  const sameMonth = period.startsOn.slice(0, 7) === period.endsOn.slice(0, 7);
  const firstDay = period.startsOn.slice(8) === "01";

  if (!isCalendarDate(period.startsOn) || !isCalendarDate(period.endsOn)) return false;

  if (!sameMonth || !firstDay) return false;

  const last = new Date(`${period.startsOn}T00:00:00.000Z`);

  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);

  return period.endsOn === last.toISOString().slice(0, 10);
}

const isCalendarDate = Accounting.isCalendarDate;

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
    ...[...new Set(basis.evidenceIds)].map((id) => ({
      kind: "evidence" as const,
      resourceId: id,
      version: id,
      reason: "Retained evidence backing a reviewed calculation input",
    })),
  ] satisfies ReadonlyArray<typeof Payroll.PayrollCalculationInputRef.Type>;
}

// The next immutable revision of one stable earning event, and the month gate.
//
// A changed input is a new revision of the same event, not a second salary and
// not a correction of history. A second earning event in the same calendar month
// needs a month-to-date base that has advanced past the first, and only an
// executed, reserved or paid run can advance it. No such owner exists yet, so the
// prior base is never approximated by summing proposals: that is an integration
// gate, named as one.
const resolveEarningRevision = Effect.fn("payroll.earningRevision")(function* (
  transaction: Transaction,
  scope: Scope,
  employeeId: string,
  period: { startsOn: string; endsOn: string },
) {
  const otherEvents = (yield* Db.readMonthEarningEvents(
    transaction,
    scope.bookId,
    employeeId,
    period.startsOn.slice(0, 7),
  )).filter(
    (row) => row.earningsPeriodStart !== period.startsOn || row.earningsPeriodEnd !== period.endsOn,
  );

  if (otherEvents.length > 0) return yield* failure("UnsupportedProfile");

  const latest = (yield* Db.readLatestEarningRevision(
    transaction,
    scope.bookId,
    employeeId,
    period.startsOn,
    period.endsOn,
  ))[0];

  const revision = (latest?.revision ?? 0) + 1;

  return revision > maximumRevisions ? yield* failure("InvalidJournal") : revision;
});

export const prepareCalculation = Effect.fn("payroll.prepareCalculation")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Payroll.PreparePayRun.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      // Current private payroll access is checked before any record is returned and
      // before a saved-command replay can hand one back. A book membership is not
      // payroll authority, and an idempotent recovery is still a read of a payroll
      // record, so it is authorized the same way. Ordinary identical-command
      // recovery is preserved for an authorized caller below.
      yield* requireTableGrants(transaction, true);
      yield* requirePayrollGrant(transaction, command.scope, principal.actorId);

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

      // The shared RuleRelease owns one nested payroll payload. Decoding the row as
      // a payroll release would read the nested fields as if they were at the root,
      // so the outer release is decoded under its own schema and its payroll
      // section is selected. A release with no payroll payload is a precise
      // unsupported profile, not a default schedule.
      const outer = Option.getOrNull(
        Schema.decodeUnknownOption(Profiles.RuleRelease)(releaseRow.body),
      );

      if (outer === null) return yield* failure("UnsupportedProfile");

      const release = outer.payroll ?? null;

      if (release === null) return yield* failure("UnsupportedProfile");

      if (releaseRow.checksum !== outer.checksum) return yield* failure("StaleDependency");

      if (release.calculatorVersion !== Payroll.SupportedCalculatorVersion) {
        return yield* failure("UnsupportedProfile");
      }

      const revision = yield* resolveEarningRevision(
        transaction,
        command.scope,
        employeeId,
        period,
      );

      const employment = (yield* Db.readRevisionHead(
        transaction,
        command.scope.bookId,
        employeeId,
        "employment",
        period.startsOn,
      ))[0];

      const work = (yield* Db.readRevisionHead(
        transaction,
        command.scope.bookId,
        employeeId,
        "work",
        period.startsOn,
      ))[0];

      const opening = (yield* Db.readRevisionHead(
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

      // A monthly pay event's earnings period is the whole calendar month. This
      // calculator declares no proration and no reduced band for an irregular
      // period, so a part-month interval is refused rather than paid a full
      // monthly salary. A same-month interval is not thereby a full month.
      if (!isWholeCalendarMonth(period)) return yield* failure("UnsupportedProfile");

      if (openingBody.asOf > period.startsOn) return yield* failure("UnsupportedProfile");

      if (BigInt(openingBody.balanceMinor) < 0n) return yield* failure("InvalidJournal");

      for (const reference of evidenceReferences(prepared)) {
        yield* requireRetainedEvidence(transaction, command.scope.bookId, reference);
      }

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
          openingBaseMinor: openingBody.balanceMinor,
          openingObligationReference: openingBody.obligation,
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
      const clockRow = (yield* Db.readRecordedAt(transaction))[0];

      if (!clockRow) return yield* failure("InternalError");

      const clock = yield* decode(Schema.Struct({ recordedAt: Schema.String }), clockRow);

      const recordedAt = clock.recordedAt;

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
        revision,
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
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireTableGrants(transaction, false);

    // A read is not a weaker boundary than the write that produced the row.
    yield* requirePayrollGrant(transaction, command.scope, principal.actorId);

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
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireTableGrants(transaction, false);
    yield* requirePayrollGrant(transaction, command.scope, principal.actorId);

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
