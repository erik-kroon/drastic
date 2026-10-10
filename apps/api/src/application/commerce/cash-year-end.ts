import { runBookCommand } from "../book-commands";
import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Cash from "@open-erp/domain/cash-method";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/commerce/cash-year-end";
import * as CoverageDb from "../../db/commerce/cash-payments";
import * as Ledger from "../../db/posting";
import * as ProfileDb from "../../db/company-profiles";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { newId } from "../identifiers";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import {
  sealActionInTransaction,
  approveChangeInTransaction,
  executeChangeInTransaction,
} from "../posting";
import { recordCashYearEndFactInTransaction } from "../vat/cash-method-facts";
import { approvalExpiry } from "./approval";
import { readCashCoverageInTransaction } from "./cash-payments";
import { requireCashAccounts, resolveCashInvoiceProfileInTransaction } from "./cash-invoices";
import { liveInvoice } from "./register";
import {
  decode,
  readEvidenceReference,
  commandReceipt,
  withBook,
  type Scope,
  type Principal,
} from "./support";

type Input = typeof CashMethod.PrepareCashYearEnd.Type;

type Selection = typeof CashMethod.CashYearEndSelection.Type;

type Plan = typeof CashMethod.CashYearEndPlan.Type;

type Member = Selection["invoices"][number];

const readPlan = Effect.fn("cashYearEnd.readPlan")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readPlan(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  const plan = yield* decode(CashMethod.CashYearEndPlan, row.body);

  const body = {
    id: plan.id,
    scope: plan.scope,
    selection: plan.selection,
    postingPlan: plan.postingPlan,
    createdBy: plan.createdBy,
    createdAt: plan.createdAt,
  };

  if ((yield* digest(body)) !== plan.digest) return yield* failure("StaleDependency");

  return plan;
});

const captureMember = Effect.fn("cashYearEnd.captureMember")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  year: string,
  cutoff: string,
  journalStart: number,
) {
  const invoice = yield* liveInvoice(tx, scope.bookId, id);

  if (invoice.kind !== "cash_method_supplier_invoice_v1" || invoice.status === "blocked")
    return yield* failure("UnsupportedProfile");

  const { basis, lines: coverage } = yield* readCashCoverageInTransaction(tx, scope, id);

  const qualified = yield* resolveCashInvoiceProfileInTransaction(tx, scope, cutoff);

  if (qualified.methodFactRevisionId !== basis.methodFactRevisionId)
    return yield* failure("UnsupportedProfile");
  yield* requireCashAccounts(
    tx,
    scope,
    {
      profile: basis.profile,
      draftId: basis.draftId,
      expectedRevision: basis.draftRevision,
      expectedDigest: basis.draftDigest,
      controlAccountId: basis.controlAccountId,
      inputVatAccountId: basis.inputVatAccountId,
      lineAssignments: basis.lines.map((line) => ({
        lineId: line.sourceLineId,
        expenseAccountId: line.expenseAccountId,
        treatment: line.treatment,
      })),
      reason: "Complete unpaid year-end recognition",
      acknowledgeSyntheticOnly: true,
    },
    cutoff,
    qualified,
  );

  const journal: Array<Cash.CashJournalLine> = [];

  const lines: Array<Member["lines"][number]> = [];

  for (const original of basis.lines) {
    const current = coverage.find((line) => line.line.sourceLineId === original.sourceLineId);

    if (!current) return yield* failure("InternalError");

    const result = Cash.prepareYearEnd({
      direction: "purchase",
      fiscalYearId: year,
      accountingCutoff: cutoff,
      complete: true,
      expectedInvoiceCount: 1,
      invoiceCount: 1,
      lines: [current.line],
      settlementControlAccountId: basis.controlAccountId,
      expenseOrRevenueAccountId: original.expenseAccountId,
      taxAccountId: basis.inputVatAccountId,
    });

    if (Result.isFailure(result)) return yield* failure("StaleDependency");

    const slice = result.success.slices[0];

    let taxJournalIndex: number | null = null;

    for (const line of result.success.journal) {
      if (line.accountId === basis.inputVatAccountId)
        taxJournalIndex = journalStart + journal.length;
      journal.push(line);
    }

    const after = slice
      ? {
          ...slice.lineAfter,
          recognizedVersion: (BigInt(current.line.recognizedVersion) + 1n).toString(),
        }
      : current.line;

    lines.push({
      lineId: current.lineId,
      before: current.line,
      after,
      paidGrossMinor: "0",
      newGrossMinor: slice?.unpaidMinor ?? "0",
      netMinor: slice?.newNetMinor ?? "0",
      taxMinor: slice?.newTaxMinor ?? "0",
      deductibleMinor: slice?.newDeductibleMinor ?? "0",
      taxJournalIndex,
    });
  }

  return {
    member: {
      invoiceId: id,
      issuedOn: invoice.issuedOn,
      revision: invoice.currentRevision.revision,
      allocationVersion: invoice.allocationVersion,
      invoiceEvidence: invoice.evidence,
      basis,
      ...qualified,
      lines,
    },
    journal,
  };
});

export const captureCashYearEndPopulationInTransaction = Effect.fn("cashYearEnd.capturePopulation")(
  function* (tx: Transaction, scope: Scope, input: Input, eventId: string) {
    const year = (yield* Db.readFiscal(tx, scope.bookId, input.fiscalYearId))[0];

    if (!year) return yield* failure("NotFound");

    if (input.cutoffOn !== year.endsOn) return yield* failure("InvalidJournal");

    const periods = yield* Db.readPeriod(tx, scope.bookId, year.endsOn, year.id);

    const period = periods[0];

    if (periods.length !== 1 || !period) return yield* failure("UnsupportedProfile");

    if (period.locked) return yield* failure("PeriodLocked");

    const qualified = yield* resolveCashInvoiceProfileInTransaction(tx, scope, year.endsOn);

    const reviewEvidence = yield* readEvidenceReference(tx, scope.bookId, input.evidenceId);

    const book = (yield* Ledger.readBook(tx, scope))[0];

    if (!book || book.profile !== "synthetic-core-v1" || book.authority !== "native")
      return yield* failure("UnsupportedProfile");

    const population = yield* Db.readPopulation(tx, scope.bookId, year.endsOn);

    if (
      population.length > 500 ||
      population.some(
        (invoice) => invoice.futurePayment || invoice.futureCredit || invoice.futureRecognition,
      )
    )
      return yield* failure("UnsupportedProfile");

    const invoices: Array<Member> = [];

    const journal: Array<Cash.CashJournalLine> = [];

    for (const invoice of population) {
      const captured = yield* captureMember(
        tx,
        scope,
        invoice.id,
        year.id,
        year.endsOn,
        journal.length,
      );

      invoices.push(captured.member);
      journal.push(...captured.journal);
    }

    const ids = [
      ...new Set(
        invoices.flatMap((invoice) => [
          invoice.basis.controlAccountId,
          invoice.basis.inputVatAccountId,
          ...invoice.basis.lines.map((line) => line.expenseAccountId),
        ]),
      ),
    ].sort();

    const accounts = yield* Ledger.readAccounts(tx, scope.bookId, ids);

    const epoch = (yield* Db.readEpoch(tx, scope.bookId))[0]?.version ?? "0";

    return yield* decode(CashMethod.CashYearEndSelection, {
      input,
      eventId,
      reviewEvidence,
      fiscalYear: year,
      period: { id: period.id, version: period.version },
      profileVersion: book.profileVersion.toString(),
      writerEpoch: book.writerEpoch.toString(),
      membershipEpoch: epoch,
      ...qualified,
      accounts: accounts.map((account) => ({
        id: account.id,
        version: account.version.toString(),
      })),
      invoices,
      journal,
    });
  },
);

const recheck = Effect.fn("cashYearEnd.recheck")(function* (
  tx: Transaction,
  scope: Scope,
  plan: Plan,
) {
  const current = yield* captureCashYearEndPopulationInTransaction(
    tx,
    scope,
    plan.selection.input,
    plan.selection.eventId,
  ).pipe(
    Effect.catchIf(
      (error) => error instanceof Accounting.AccountingError && error.code !== "PeriodLocked",
      () => Effect.succeed(null),
    ),
  );

  if (!current || !equalJson(current, plan.selection)) return yield* failure("StaleDependency");
});

const preparePosting = Effect.fn("cashYearEnd.preparePosting")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  id: string,
  selection: Selection,
) {
  if (selection.journal.length === 0) return null;

  const refs = new Map([
    [selection.reviewEvidence.evidenceId, { ...selection.reviewEvidence, locator: id }],
  ]);

  for (const member of selection.invoices)
    refs.set(member.invoiceEvidence.evidenceId, {
      ...member.invoiceEvidence,
      locator: member.basis.draftId,
    });

  const action = yield* decode(Accounting.VoucherPostingAction, {
    kind: "post_voucher",
    correctsVoucherId: null,
    eventId: selection.eventId,
    postingPurpose: "adjustment",
    occurrenceKey: `cash_year_end_${selection.fiscalYear.id}`,
    fiscalYearId: selection.fiscalYear.id,
    accountingPeriodId: selection.period.id,
    postingDate: selection.fiscalYear.endsOn,
    series: selection.input.series,
    currency: "SEK",
    description: "Complete cash-method unpaid year-end recognition",
    rationale: selection.input.rationale,
    taxAssessment: "not_applicable",
    evidenceRefs: [...refs.values()],
    lines: selection.journal.map((line) => ({
      lineId: newId("line"),
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
      description: line.description,
    })),
  });

  return yield* sealActionInTransaction(tx, principal, scope, action);
});

export const prepareCashYearEnd = Effect.fn("cashYearEnd.prepare")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Input },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      return yield* runBookCommand(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "cash_year_end_prepare",
          actorId: principal.actorId,
          input: command.input,
        },
        CashMethod.CashYearEndPlan,
        Effect.gen(function* () {
          if ((yield* Db.readRun(tx, command.scope.bookId, command.input.fiscalYearId))[0])
            return yield* failure("IdempotencyConflict");

          const id = newId("cashyearplan");

          const eventId = newId("event");

          const selection = yield* captureCashYearEndPopulationInTransaction(
            tx,
            command.scope,
            command.input,
            eventId,
          );

          yield* Ledger.insertEvent(
            tx,
            command.scope.bookId,
            eventId,
            selection.reviewEvidence.evidenceId,
            `cash_year_end_${id}`,
          );

          const postingPlan = yield* preparePosting(tx, principal, command.scope, id, selection);

          const body = {
            id,
            scope: command.scope,
            selection,
            postingPlan,
            createdBy: principal.actorId,
            createdAt: yield* isoNow(tx),
          };

          const plan = yield* decode(CashMethod.CashYearEndPlan, {
            ...body,
            digest: yield* digest(body),
          });

          yield* Db.insertPlan(tx, command.scope.bookId, plan);

          return plan;
        }),
      );
    },
    "update",
  );
});

export const approveCashYearEnd = Effect.fn("cashYearEnd.approve")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CashMethod.ApproveCashYearEnd.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      return yield* runBookCommand(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "cash_year_end_approve",
          actorId: principal.actorId,
          input: { id: command.id, input: command.input },
        },
        CashMethod.CashYearEndApproval,
        Effect.gen(function* () {
          const plan = yield* readPlan(tx, command.scope, command.id);

          if (plan.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

          if (plan.digest !== command.input.planDigest) return yield* failure("StaleDependency");
          yield* recheck(tx, command.scope, plan);

          const kernel =
            plan.postingPlan === null
              ? null
              : yield* approveChangeInTransaction(tx, principal, {
                  scope: command.scope,
                  changeSetId: plan.postingPlan.id,
                  idempotencyKey: `yearapprove_${plan.id}`,
                  input: { version: 1, planDigest: plan.postingPlan.planDigest },
                });

          const approval = yield* decode(CashMethod.CashYearEndApproval, {
            id: newId("cashyearapproval"),
            planId: plan.id,
            planDigest: plan.digest,
            actorId: principal.actorId,
            expiresAt: yield* approvalExpiry(tx),
            cashPostingApprovalId: kernel?.id ?? null,
            receipt: commandReceipt(
              command.idempotencyKey,
              "cash_year_end_approve",
              principal.actorId,
            ),
          });

          yield* Db.insertApproval(tx, command.scope.bookId, approval);

          return approval;
        }),
      );
    },
    "update",
  );
});

const executeMembers = Effect.fn("cashYearEnd.executeMembers")(function* (
  tx: Transaction,
  principal: Principal,
  scope: Scope,
  plan: Plan,
  receipt: typeof CashMethod.CashYearEndReceipt.Type,
) {
  for (const member of plan.selection.invoices) {
    for (const line of member.lines) {
      if (BigInt(line.newGrossMinor) === 0n) continue;

      const posting = receipt.postingReceipt;

      if (!posting) return yield* failure("InternalError");
      yield* CoverageDb.insertCoverage(tx, scope.bookId, {
        id: line.lineId,
        invoiceId: member.invoiceId,
        witness: member.methodFactRevisionId,
        line: line.before,
      });

      const suffix = (yield* digest({ runId: receipt.id, lineId: line.lineId })).slice(7);

      const recognitionId = `cashrec_${suffix}`;

      const factId = BigInt(line.taxMinor) > 0n ? `cashvat_${suffix}` : null;
      yield* Db.insertRecognition(tx, scope.bookId, {
        id: recognitionId,
        runId: receipt.id,
        lineId: line.lineId,
        line,
        evidenceId: plan.selection.reviewEvidence.evidenceId,
        changeSetId: posting.changeSetId,
        voucherId: posting.voucherId,
        factId,
      });

      if (factId !== null) {
        const taxLine =
          line.taxJournalIndex === null
            ? undefined
            : plan.postingPlan?.groups[0]?.actions[0]?.lines[line.taxJournalIndex];

        if (!taxLine) return yield* failure("InternalError");
        yield* recordCashYearEndFactInTransaction(tx, principal, {
          scope,
          recognitionId,
          factId,
          invoiceId: member.invoiceId,
          line,
          voucherId: posting.voucherId,
          taxLineId: taxLine.lineId,
          witness: member.vatWitness,
          receiptId: receipt.id,
          reviewEvidence: plan.selection.reviewEvidence,
          cutoffOn: plan.selection.fiscalYear.endsOn,
        });
      }

      if (
        !(yield* CoverageDb.advanceCoverage(
          tx,
          scope.bookId,
          line.lineId,
          line.before,
          line.after,
        ))[0]
      )
        return yield* failure("StaleDependency");
    }

    yield* Db.insertMember(tx, scope.bookId, receipt.id, member);
  }
});

export const executeCashYearEnd = Effect.fn("cashYearEnd.execute")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof CashMethod.ExecuteCashYearEnd.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      return yield* runBookCommand(
        tx,
        {
          scope: command.scope,
          idempotencyKey: command.idempotencyKey,
          operation: "cash_year_end_execute",
          actorId: principal.actorId,
          input: { id: command.id, input: command.input },
        },
        CashMethod.CashYearEndReceipt,
        Effect.gen(function* () {
          const plan = yield* readPlan(tx, command.scope, command.id);

          if ((yield* Db.readRun(tx, command.scope.bookId, plan.selection.fiscalYear.id))[0])
            return yield* failure("IdempotencyConflict");

          if (plan.digest !== command.input.planDigest) return yield* failure("StaleDependency");
          yield* recheck(tx, command.scope, plan);

          const row = (yield* Db.readApproval(
            tx,
            command.scope.bookId,
            command.input.approvalId,
          ))[0];

          if (!row || row.consumed) return yield* failure("ApprovalRequired");

          const approval = yield* decode(CashMethod.CashYearEndApproval, row.body);

          if (
            approval.planId !== plan.id ||
            approval.planDigest !== plan.digest ||
            approval.actorId === plan.createdBy ||
            approval.expiresAt <= (yield* isoNow(tx))
          )
            return yield* failure("ApprovalRequired");

          if (
            !(yield* Ledger.readOperatorMembership(tx, command.scope.bookId, approval.actorId))[0]
          )
            return yield* failure("ApprovalRequired");

          const admission = (yield* Ledger.readActorAdmission(tx, approval.actorId))[0];

          if (admission?.enabled === false) return yield* failure("ApprovalRequired");

          const postingReceipt =
            plan.postingPlan === null
              ? null
              : yield* executeChangeInTransaction(tx, principal, {
                  scope: command.scope,
                  changeSetId: plan.postingPlan.id,
                  idempotencyKey: `yearexecute_${plan.id}`,
                  input: {
                    version: 1,
                    planDigest: plan.postingPlan.planDigest,
                    approvalId: approval.cashPostingApprovalId ?? "approval_missing",
                  },
                  owner: { kind: "cash_year_end", id: plan.id },
                });

          const lines = plan.selection.invoices.flatMap((invoice) => invoice.lines);

          const total = (field: "newGrossMinor" | "netMinor" | "taxMinor") =>
            lines.reduce((sum, line) => sum + BigInt(line[field]), 0n).toString();

          const receipt = yield* decode(CashMethod.CashYearEndReceipt, {
            id: newId("cashyearrun"),
            scope: command.scope,
            planId: plan.id,
            approvalId: approval.id,
            fiscalYearId: plan.selection.fiscalYear.id,
            cutoffOn: plan.selection.fiscalYear.endsOn,
            memberCount: plan.selection.invoices.length,
            recognizedLineCount: lines.filter((line) => BigInt(line.newGrossMinor) > 0n).length,
            recognizedGrossMinor: total("newGrossMinor"),
            netMinor: total("netMinor"),
            taxMinor: total("taxMinor"),
            populationDigest: yield* digest(plan.selection),
            members: plan.selection.invoices,
            postingReceipt,
            committedAt: yield* isoNow(tx),
            receipt: commandReceipt(
              command.idempotencyKey,
              "cash_year_end_execute",
              principal.actorId,
            ),
          });

          yield* Db.insertRun(tx, command.scope.bookId, plan, receipt, principal.actorId);
          yield* executeMembers(tx, principal, command.scope, plan, receipt);

          if (!(yield* Db.consumeApproval(tx, command.scope.bookId, approval.id))[0])
            return yield* failure("ApprovalRequired");

          yield* Db.bumpPopulation(tx, command.scope.bookId);

          return receipt;
        }),
      );
    },
    "update",
  );
});

const hasConfirmedCashMethod = Effect.fn("cashYearEnd.hasConfirmedCashMethod")(function* (
  tx: Transaction,
  scope: Scope,
  cutoff: string,
) {
  const facts = (yield* ProfileDb.readFactRevisions(tx, scope.entityId, cutoff, cutoff)).filter(
    (fact) => fact.factKind === "accounting_method",
  );

  const reviews = yield* ProfileDb.readFactReviews(
    tx,
    scope.entityId,
    facts.map((fact) => fact.id),
  );

  let cash = false;

  let confirmed = 0;

  for (const row of facts) {
    const retained = reviews.find((review) => review.factRevisionId === row.id);

    if (!retained) continue;

    const review = yield* decode(Profiles.FactReview, retained.body);

    if (review.result !== "confirmed" || review.revisionDigest !== row.digest) continue;

    const fact = yield* decode(Profiles.FactRevision, row.body);

    confirmed += 1;

    if (fact.value.state === "known" && fact.value.value === "cash") cash = true;
  }

  if (cash && confirmed !== 1) return yield* failure("UnsupportedProfile");

  return cash;
});

export const requireCashYearEndForClose = Effect.fn("cashYearEnd.requireForFinancialClose")(
  function* (tx: Transaction, scope: Scope, fiscalYearId: string) {
    const year = (yield* Db.readFiscal(tx, scope.bookId, fiscalYearId))[0];

    if (!year) return yield* failure("NotFound");

    const population = yield* Db.readPopulation(tx, scope.bookId, year.endsOn);

    const cashIds: Array<string> = [];

    for (const row of population) {
      const invoice = yield* liveInvoice(tx, scope.bookId, row.id);

      if (invoice.kind === "cash_method_supplier_invoice_v1") cashIds.push(row.id);
    }

    const run = (yield* Db.readRun(tx, scope.bookId, fiscalYearId))[0];

    if (cashIds.length === 0 && !run) {
      if (!(yield* hasConfirmedCashMethod(tx, scope, year.endsOn))) return null;

      yield* resolveCashInvoiceProfileInTransaction(tx, scope, year.endsOn);
    }

    if (cashIds.length !== population.length) return yield* failure("UnsupportedProfile");

    if (!run?.body) return yield* failure("ApprovalRequired");

    const receipt = yield* decode(CashMethod.CashYearEndReceipt, run.body);

    if (
      !equalJson(
        cashIds,
        receipt.members.map((member) => member.invoiceId),
      )
    )
      return yield* failure("StaleDependency");

    const plan = yield* readPlan(tx, scope, receipt.planId);

    if (
      receipt.id !== run.id ||
      !equalJson(receipt.scope, scope) ||
      receipt.fiscalYearId !== year.id ||
      receipt.cutoffOn !== year.endsOn ||
      receipt.memberCount !== receipt.members.length ||
      !equalJson(receipt.members, plan.selection.invoices) ||
      receipt.populationDigest !== (yield* digest(plan.selection)) ||
      !equalJson(plan.selection.fiscalYear, year)
    )
      return yield* failure("StaleDependency");

    const qualified = yield* resolveCashInvoiceProfileInTransaction(tx, scope, year.endsOn).pipe(
      Effect.catchIf(
        (error) =>
          error instanceof Accounting.AccountingError && error.code === "UnsupportedProfile",
        () => failure("StaleDependency"),
      ),
    );

    if (
      qualified.methodFactRevisionId !== plan.selection.methodFactRevisionId ||
      !equalJson(qualified.postingWitness, plan.selection.postingWitness) ||
      !equalJson(qualified.vatWitness, plan.selection.vatWitness)
    )
      return yield* failure("StaleDependency");

    for (const id of cashIds) {
      const current = yield* readCashCoverageInTransaction(tx, scope, id);

      const member = receipt.members.find((item) => item.invoiceId === id);

      const invoice = yield* liveInvoice(tx, scope.bookId, id);

      if (
        !member ||
        invoice.status === "blocked" ||
        invoice.currentRevision.revision !== member.revision ||
        !equalJson(current.basis, member.basis) ||
        current.lines.some(
          ({ line }) =>
            BigInt(line.recognizedGrossMinor) + BigInt(line.creditedGrossMinor) !==
            BigInt(line.netMinor) + BigInt(line.taxMinor),
        )
      )
        return yield* failure("StaleDependency");
    }

    return receipt;
  },
);
