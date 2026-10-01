import { addMatch } from "../banking/matches";
import {
  prepareBankMatchReversalInTransaction,
  approveBankMatchReversalInTransaction,
  executeBankMatchReversalInTransaction,
} from "../banking/match-reversals";
import {
  applyAllocationInTransaction,
  prepareAllocationReversalInTransaction,
  approveAllocationReversalInTransaction,
  executeAllocationReversalInTransaction,
} from "../commerce/allocation-reversals";
import {
  executeChangeInTransaction,
  prepareCorrectionInTransaction,
  validatePlan,
} from "../posting";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Settlement from "@open-erp/contracts/supplier-settlements";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/purchases/supplier-settlements";
import * as LedgerDb from "../../db/posting";
import * as CorrectionDb from "../../db/posting-corrections";
import * as InvoiceDb from "../../db/commerce/invoices";
import * as AllocationDb from "../../db/commerce/allocations";
import * as StatementDb from "../../db/banking/statements";
import * as ProfileDb from "../../db/company-profiles";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { withAdmittedPrincipal, type VerifiedPrincipal } from "../identity";
import { decode, toJsonObject, commandReceipt, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest, canonicalText } from "../json";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import {
  sealProspectiveSupplierAllocationInTransaction,
  approveProspectiveSupplierAllocationInTransaction,
} from "../commerce/allocation-reversals";
import {
  readBook,
  readVoucher,
  readPeriod,
  newId,
  isoNow,
  replay,
  saveCommand,
  sealActionInTransaction,
  approveChangeInTransaction,
} from "../posting";

const profile = "synthetic-supplier-settlement-accrual-v1";

type Plan = typeof Settlement.SupplierSettlementPlan.Type;

type Approval = typeof Settlement.SupplierSettlementApproval.Type;

function owned<A, R>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  planId: string | null,
  operation: (tx: Transaction, actor: VerifiedPrincipal) => Effect.Effect<A, unknown, R>,
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    {
      operatorOnly,
      beforeBook: (tx) =>
        Effect.gen(function* () {
          if (planId === null) return;

          for (const reviewer of yield* Db.readApprovalActors(tx, scope.bookId, planId)) {
            yield* LedgerDb.readActorAdmission(tx, reviewer.actorId);
            yield* LedgerDb.readOperatorMembership(tx, scope.bookId, reviewer.actorId);
          }
        }).pipe(Effect.mapError(databaseFailure)),
    },
    (tx, actor) => operation(tx, actor).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
}

const qualifiedProfile = Effect.fn("purchases.supplierSettlement.qualifiedProfile")(function* (
  tx: Transaction,
  scope: Scope,
  date: string,
  bankAccountId: string,
  controlAccountId: string,
) {
  const resolved = yield* resolveCompanyProfileInTransaction(tx, scope, "synthetic", {
    postingOn: date,
    taxPointOn: null,
    paymentOn: null,
    reportOn: null,
    taxPeriodOn: null,
  });

  const witness = resolved.families.find(
    (family) => family.family === "posting_eligibility",
  )?.witness;

  if (!witness) return yield* failure("UnsupportedProfile");

  const release = (yield* ProfileDb.readRuleReleases(tx, "posting_eligibility")).find(
    (entry) => entry.id === witness.ruleReleaseId,
  );

  if (!release) return yield* failure("UnsupportedProfile");
  const rule = yield* decode(Profiles.RuleRelease, release.body);

  if (
    rule.calculatorVersion !== profile ||
    !rule.requiredFactKinds.includes("accounting_method") ||
    !rule.requiredRoleKinds.includes("bank") ||
    !rule.requiredRoleKinds.includes("commerce")
  )
    return yield* failure("UnsupportedProfile");
  const facts = yield* ProfileDb.readFactRevisions(tx, scope.entityId, date, date);

  const method = facts.find(
    (fact) => witness.factRevisionIds.includes(fact.id) && fact.factKind === "accounting_method",
  );

  if (!method) return yield* failure("UnsupportedProfile");
  const fact = yield* decode(Profiles.FactRevision, method.body);

  if (fact.value.state !== "known" || fact.value.value !== "accrual")
    return yield* failure("UnsupportedProfile");
  const bindings = yield* ProfileDb.readRoleBindings(tx, scope.bookId, date, date);

  for (const [kind, account] of [
    ["bank", bankAccountId],
    ["commerce", controlAccountId],
  ]) {
    if (
      !bindings.some(
        (binding) =>
          witness.roleBindingIds.includes(binding.id) &&
          binding.roleKind === kind &&
          binding.accountId === account,
      )
    )
      return yield* failure("UnsupportedProfile");
  }

  return witness;
});

function observationAgrees(
  source: typeof Bank.StatementSource.Type,
  row: typeof Bank.BankRow.Type,
  statement: StatementDb.StatementRow,
  observed: StatementDb.ObservationRow,
  currency: string,
) {
  return (
    row.amountMinor === observed.amountMinor &&
    row.date === observed.observedOn &&
    row.description === observed.description &&
    row.providerId === observed.providerId &&
    source.accountId === statement.accountId &&
    source.sourceBankAccountId === observed.sourceBankAccountId &&
    source.statementIdentifier === statement.statementIdentifier &&
    source.startsOn === statement.startsOn &&
    source.endsOn === statement.endsOn &&
    source.currency === currency &&
    BigInt(row.amountMinor) < 0n
  );
}

function supportsSettlementBook(book: {
  profile: string;
  authority: string;
  currency: string;
  currencyScale: number;
}) {
  return (
    book.profile === "synthetic-core-v1" &&
    book.authority === "native" &&
    book.currency === "SEK" &&
    book.currencyScale === 2
  );
}

const captureBasis = Effect.fn("purchases.supplierSettlement.captureBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Settlement.PrepareSupplierSettlement.Type,
) {
  yield* requireUnclaimedSource(tx, scope, input);

  const book = yield* readBook(tx, scope);

  if (!supportsSettlementBook(book)) return yield* failure("UnsupportedProfile");
  const live = (yield* InvoiceDb.readLiveInvoice(tx, scope.bookId, input.invoiceId))[0];
  const statement = (yield* StatementDb.readStatement(tx, scope.bookId, input.statementId))[0];

  const observed = (yield* StatementDb.readObservation(
    tx,
    scope.bookId,
    input.statementId,
    input.rowOrdinal,
  ))[0];

  if (!live || !statement || !observed) return yield* failure("NotFound");
  const invoice = yield* decode(Commerce.Invoice, live.body);
  const source = yield* decode(Bank.StatementSource, statement.source);
  const row = source.rows.find((entry) => entry.rowOrdinal === input.rowOrdinal);

  if (row && row.providerId !== null) return yield* failure("UnsupportedProfile");

  if (
    !row ||
    !observationAgrees(source, row, statement, observed, book.currency) ||
    source.currency !== invoice.currency
  )
    return yield* failure("InvalidJournal");

  if (
    invoice.direction !== "supplier" ||
    invoice.recognition === null ||
    invoice.cashMethod !== undefined ||
    invoice.status === "blocked" ||
    invoice.outstandingMinor === null
  )
    return yield* failure("UnsupportedProfile");

  if (invoice.recognition.postingDate > row.date) return yield* failure("InvalidJournal");

  if (-BigInt(row.amountMinor) > BigInt(invoice.outstandingMinor))
    return yield* failure("StaleDependency");
  const evidence = (yield* LedgerDb.readEvidence(tx, scope.bookId, statement.evidenceId))[0];

  if (!evidence) return yield* failure("MissingEvidence");

  if (input.evidence.evidenceId !== evidence.id || input.evidence.sha256 !== evidence.sha256)
    return yield* failure("InvalidJournal");

  const declared = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Bank.StatementSource))(
    evidence.content,
  ).pipe(Effect.mapError(() => failure("InvalidJournal")));

  if ((yield* canonicalText(declared)) !== (yield* canonicalText(source)))
    return yield* failure("InvalidJournal");

  const state = (yield* Db.readSourceState(
    tx,
    scope.bookId,
    input.statementId,
    input.rowOrdinal,
  ))[0];

  if (!state || state.ambiguous) return yield* failure("StaleDependency");

  if (state.occupied) return yield* failure("AlreadyPosted");

  const periods = (yield* LedgerDb.readAllPeriods(tx, scope.bookId)).filter(
    (period) => period.startsOn <= row.date && period.endsOn >= row.date,
  );

  if (periods.length !== 1 || !periods[0]) return yield* failure("InvalidJournal");
  const period = yield* readPeriod(tx, scope, periods[0].id);

  if (period.locked) return yield* failure("PeriodLocked");

  const accounts = yield* LedgerDb.readAccounts(
    tx,
    scope.bookId,
    [invoice.controlAccountId, source.accountId].sort(),
  );

  if (accounts.length !== 2 || accounts.some((account) => !account.active))
    return yield* failure("StaleDependency");

  const witness = yield* qualifiedProfile(
    tx,
    scope,
    row.date,
    source.accountId,
    invoice.controlAccountId,
  );

  const original = yield* readVoucher(tx, scope, invoice.recognition.voucherId);

  return yield* decode(Settlement.SupplierSettlementBasis, {
    invoice,
    source,
    statementId: statement.id,
    sourceEvidence: { evidenceId: evidence.id, sha256: evidence.sha256 },
    observation: row,
    sourceRevision: state.sourceRevision,
    profileWitness: witness,
    profileVersion: book.profileVersion.toString(),
    writerEpoch: book.writerEpoch.toString(),
    periodId: period.id,
    periodVersion: period.version.toString(),
    fiscalYearId: period.fiscalYearId,
    series: original.action.series,
    accounts: accounts.map((account) => ({ id: account.id, version: account.version.toString() })),
  });
});

const readPlan = Effect.fn("purchases.supplierSettlement.readPlan")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const stored = (yield* Db.readPlan(tx, scope.bookId, id))[0];

  if (!stored) return yield* failure("NotFound");
  const plan = yield* decode(Settlement.SupplierSettlementPlan, stored.body);

  const body = yield* toJsonObject(
    Object.fromEntries(Object.entries(plan).filter(([name]) => name !== "digest")),
  );

  if ((yield* digest(body)) !== plan.digest) return yield* failure("StaleDependency");

  return plan;
});

const basisCurrent = Effect.fn("purchases.supplierSettlement.basisCurrent")(function* (
  tx: Transaction,
  plan: Plan,
) {
  const current = yield* captureBasis(tx, plan.scope, plan.input).pipe(
    Effect.catchIf(
      (error) => error instanceof Accounting.AccountingError && error.code === "UnsupportedProfile",
      () => Effect.succeed(null),
    ),
  );

  if (current === null) return false;

  return (yield* canonicalText(current)) === (yield* canonicalText(plan.basis));
});

export const prepareSupplierSettlement = Effect.fn("purchases.supplierSettlement.prepare")(
  function* (
    token: string,
    command: {
      scope: Scope;
      idempotencyKey: string;
      input: typeof Settlement.PrepareSupplierSettlement.Type;
    },
  ) {
    return yield* owned(token, command.scope, false, null, (tx, actor) =>
      Effect.gen(function* () {
        const operation = "prepare_supplier_settlement";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          actor.actorId,
          command.input,
          Settlement.SupplierSettlementPlan,
        );

        if (request.previous) return request.previous;
        const basis = yield* captureBasis(tx, command.scope, command.input);
        const amountMinor = (-BigInt(basis.observation.amountMinor)).toString();
        const id = newId("supplier_settlement");
        const reservedVoucherId = newId("voucher");
        const controlLineId = newId("line");
        const bankLineId = newId("line");

        const eventKey = `supplier_settlement_${basis.statementId}_${basis.observation.rowOrdinal}`;

        const events = yield* LedgerDb.readEvent(
          tx,
          command.scope.bookId,
          basis.sourceEvidence.evidenceId,
          eventKey,
        );

        const eventId = events[0]?.id ?? newId("event");

        if (events.length === 0) {
          yield* LedgerDb.insertEvent(
            tx,
            command.scope.bookId,
            eventId,
            basis.sourceEvidence.evidenceId,
            eventKey,
          );
        }

        const paymentPlan = yield* sealActionInTransaction(tx, actor, command.scope, {
          kind: "post_voucher",
          postingPurpose: "adjustment",
          correctsVoucherId: null,
          eventId,
          occurrenceKey: `${basis.statementId}_${basis.observation.rowOrdinal}`,
          fiscalYearId: basis.fiscalYearId,
          accountingPeriodId: basis.periodId,
          postingDate: basis.observation.date,
          series: basis.series,
          currency: "SEK",
          description: command.input.rationale,
          rationale: command.input.rationale,
          taxAssessment: "not_applicable",
          evidenceRefs: [
            {
              ...basis.sourceEvidence,
              locator: `statement:${basis.statementId}:row:${basis.observation.rowOrdinal}`,
            },
          ],
          lines: [
            {
              lineId: controlLineId,
              accountId: basis.invoice.controlAccountId,
              debitMinor: amountMinor,
              creditMinor: "0",
              description: "Observed supplier payment",
            },
            {
              lineId: bankLineId,
              accountId: basis.source.accountId,
              debitMinor: "0",
              creditMinor: amountMinor,
              description: "Original bank debit",
            },
          ],
        });

        const account = basis.accounts.find((entry) => entry.id === basis.invoice.controlAccountId);
        const invoice = basis.invoice;

        if (!account || invoice.outstandingMinor === null || invoice.recognition === null)
          return yield* failure("StaleDependency");

        const pendingAllocation = yield* sealProspectiveSupplierAllocationInTransaction(
          tx,
          actor,
          command.scope,
          command.idempotencyKey,
          {
            profileVersion: basis.profileVersion,
            writerEpoch: basis.writerEpoch,
            accountVersion: account.version,
            paymentPeriodVersion: basis.periodVersion,
            payment: {
              voucherId: reservedVoucherId,
              lineId: controlLineId,
              scope: command.scope,
              direction: "supplier",
              accountId: invoice.controlAccountId,
              postingDate: basis.observation.date,
              currency: "SEK",
              currencyScale: 2,
              amountMinor,
              allocatedMinor: "0",
              remainingMinor: amountMinor,
              capacityVersion: "0",
            },
            evidence: basis.sourceEvidence,
            rationale: command.input.rationale,
            totalMinor: amountMinor,
            paymentRemainingAfterMinor: "0",
            legs: [
              {
                invoiceId: invoice.id,
                revision: invoice.currentRevision.revision,
                allocationVersion: invoice.allocationVersion,
                documentNumber: invoice.documentNumber,
                counterpartyId: invoice.counterpartyId,
                counterpartyName: invoice.counterpartyName,
                recognition: invoice.recognition,
                evidence: invoice.evidence,
                outstandingBeforeMinor: invoice.outstandingMinor,
                amountMinor,
                outstandingAfterMinor: (
                  BigInt(invoice.outstandingMinor) - BigInt(amountMinor)
                ).toString(),
              },
            ],
          },
        );

        const body = yield* toJsonObject({
          id,
          scope: command.scope,
          version: 1,
          profile,
          input: command.input,
          basis,
          amountMinor,
          paymentPlan,
          actionDigest: yield* digest(yield* toJsonObject(paymentPlan.groups[0]?.actions[0])),
          reservedVoucherId,
          controlLineId,
          bankLineId,
          pendingAllocation,
          createdBy: actor.actorId,
          createdAt: yield* isoNow(tx),
          receipt: commandReceipt(command.idempotencyKey, operation, actor.actorId),
        });

        const plan = yield* decode(Settlement.SupplierSettlementPlan, {
          ...body,
          digest: yield* digest(body),
        });

        yield* Db.insertPlan(tx, plan);
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          actor.actorId,
          yield* toJsonObject(plan),
        );

        return plan;
      }),
    );
  },
);

export const approveSupplierSettlement = Effect.fn("purchases.supplierSettlement.approve")(
  function* (
    token: string,
    command: {
      scope: Scope;
      planId: string;
      idempotencyKey: string;
      input: typeof Settlement.ApproveSupplierSettlement.Type;
    },
  ) {
    return yield* owned(token, command.scope, true, command.planId, (tx, actor) =>
      Effect.gen(function* () {
        const operation = "approve_supplier_settlement";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          actor.actorId,
          { id: command.planId, input: command.input },
          Settlement.SupplierSettlementApproval,
        );

        if (request.previous) return request.previous;
        const plan = yield* readPlan(tx, command.scope, command.planId);

        if (plan.createdBy === actor.actorId) return yield* failure("Forbidden");

        if (plan.digest !== command.input.digest || !(yield* basisCurrent(tx, plan)))
          return yield* failure("StaleDependency");
        const id = newId("supplier_approval");

        const payment = yield* approveChangeInTransaction(tx, actor, {
          scope: command.scope,
          changeSetId: plan.paymentPlan.id,
          idempotencyKey: `${id}_posting`,
          input: { version: 1, planDigest: plan.paymentPlan.planDigest },
          owner: { kind: "supplier_settlement", id: plan.id },
        });

        const allocation = yield* approveProspectiveSupplierAllocationInTransaction(
          tx,
          actor,
          command.scope,
          plan.id,
          plan.pendingAllocation,
          `${id}_allocation`,
        );

        const approval = yield* decode(Settlement.SupplierSettlementApproval, {
          id,
          scope: command.scope,
          planId: plan.id,
          version: 1,
          digest: plan.digest,
          actorId: actor.actorId,
          expiresAt:
            Date.parse(payment.expiresAt) < Date.parse(allocation.expiresAt)
              ? payment.expiresAt
              : allocation.expiresAt,
          paymentApprovalId: payment.id,
          allocationApprovalId: allocation.id,
          receipt: commandReceipt(command.idempotencyKey, operation, actor.actorId),
        });

        yield* Db.insertApproval(tx, approval);
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          actor.actorId,
          yield* toJsonObject(approval),
        );

        return approval;
      }),
    );
  },
);

const approvalUsable = Effect.fn("purchases.supplierSettlement.approvalUsable")(function* (
  tx: Transaction,
  plan: Plan,
  approval: Approval,
) {
  if (
    (yield* Db.readRevocation(tx, plan.scope.bookId, approval.id)).length > 0 ||
    approval.digest !== plan.digest ||
    !(Date.parse(approval.expiresAt) > Date.parse(yield* isoNow(tx)))
  )
    return false;
  const actors = yield* LedgerDb.readOperatorMembership(tx, plan.scope.bookId, approval.actorId);
  const admission = (yield* LedgerDb.readActorAdmission(tx, approval.actorId))[0];

  const payment = (yield* LedgerDb.readApproval(
    tx,
    plan.scope.bookId,
    approval.paymentApprovalId,
  ))[0];

  const allocation = (yield* AllocationDb.readAllocationApproval(
    tx,
    plan.scope.bookId,
    approval.allocationApprovalId,
  ))[0];

  if (
    !payment ||
    !allocation ||
    actors.length !== 1 ||
    admission?.enabled !== true ||
    payment.consumedAt !== null ||
    payment.changeSetId !== plan.paymentPlan.id ||
    allocation.planId !== plan.pendingAllocation.id ||
    payment.actorId !== approval.actorId ||
    allocation.actorId !== approval.actorId ||
    payment.digest !== plan.paymentPlan.planDigest ||
    allocation.digest !== plan.pendingAllocation.digest ||
    !(Date.parse(payment.expiresAt) > Date.parse(yield* isoNow(tx))) ||
    !(Date.parse(allocation.expiresAt) > Date.parse(yield* isoNow(tx))) ||
    (yield* LedgerDb.readApprovalRevocation(tx, plan.scope.bookId, payment.id)).length > 0
  )
    return false;

  return true;
});

export const getSupplierSettlement = Effect.fn("purchases.supplierSettlement.get")(function* (
  token: string,
  input: { scope: Scope; planId: string },
) {
  return yield* owned(token, input.scope, false, input.planId, (tx) =>
    Effect.gen(function* () {
      const plan = yield* readPlan(tx, input.scope, input.planId);

      const current = yield* basisCurrent(tx, plan).pipe(
        Effect.catchIf(
          (error) =>
            error instanceof Accounting.AccountingError &&
            ["StaleDependency", "PeriodLocked", "UnsupportedProfile", "AlreadyPosted"].includes(
              error.code,
            ),
          () => Effect.succeed(false),
        ),
      );

      const approvals = yield* Db.readApprovals(tx, input.scope.bookId, plan.id);
      const latest = approvals[approvals.length - 1];

      const approval = latest
        ? yield* decode(Settlement.SupplierSettlementApproval, latest.body)
        : null;

      return {
        plan,
        approval,
        pendingBasisCurrent: current,
        approvalUsable: current && approval !== null && (yield* approvalUsable(tx, plan, approval)),
        paymentPosted: (yield* Db.readReceiptByPlan(tx, input.scope.bookId, plan.id)).length > 0,
        executionAvailable:
          current && approval !== null && (yield* approvalUsable(tx, plan, approval)),
      };
    }),
  );
});

export const revokeSupplierSettlementApproval = Effect.fn("purchases.supplierSettlement.revoke")(
  function* (
    token: string,
    command: {
      scope: Scope;
      approvalId: string;
      idempotencyKey: string;
      input: typeof Settlement.RevokeSupplierSettlementApproval.Type;
    },
  ) {
    return yield* owned(token, command.scope, true, null, (tx, actor) =>
      Effect.gen(function* () {
        const operation = "revoke_supplier_settlement_approval";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          actor.actorId,
          { id: command.approvalId, input: command.input },
          Settlement.SupplierSettlementApprovalRevocation,
        );

        if (request.previous) return request.previous;
        const stored = (yield* Db.readApproval(tx, command.scope.bookId, command.approvalId))[0];

        if (!stored) return yield* failure("NotFound");

        const existing = (yield* Db.readRevocation(
          tx,
          command.scope.bookId,
          command.approvalId,
        ))[0];

        const result = existing
          ? yield* decode(Settlement.SupplierSettlementApprovalRevocation, existing.body)
          : {
              approvalId: command.approvalId,
              actorId: actor.actorId,
              reason: command.input.reason,
              revokedAt: yield* isoNow(tx),
              receipt: commandReceipt(command.idempotencyKey, operation, actor.actorId),
            };

        if (!existing) yield* Db.insertRevocation(tx, command.scope.bookId, result);
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          actor.actorId,
          yield* toJsonObject(result),
        );

        return result;
      }),
    );
  },
);

const readSettlementReceipt = Effect.fn("purchases.supplierSettlement.readReceipt")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readReceipt(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const receipt = yield* decode(Settlement.SupplierSettlementReceipt, row.body);

  if (receipt.scope.entityId !== scope.entityId) return yield* failure("NotFound");

  return receipt;
});

export const executeSupplierSettlement = Effect.fn("purchases.supplierSettlement.execute")(
  function* (
    token: string,
    command: {
      scope: Scope;
      planId: string;
      idempotencyKey: string;
      input: typeof Settlement.ExecuteSupplierSettlement.Type;
    },
  ) {
    return yield* owned(token, command.scope, false, command.planId, (tx, actor) =>
      Effect.gen(function* () {
        const operation = "execute_supplier_settlement";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          actor.actorId,
          { id: command.planId, input: command.input },
          Settlement.SupplierSettlementReceipt,
        );

        if (request.previous) return request.previous;
        const plan = yield* readPlan(tx, command.scope, command.planId);

        if ((yield* Db.readReceiptByPlan(tx, command.scope.bookId, plan.id)).length > 0)
          return yield* failure("AlreadyPosted");

        if (command.input.digest !== plan.digest || !(yield* basisCurrent(tx, plan)))
          return yield* failure("StaleDependency");
        const row = (yield* Db.readApproval(tx, command.scope.bookId, command.input.approvalId))[0];

        if (!row || row.planId !== plan.id) return yield* failure("ApprovalRequired");
        const approval = yield* decode(Settlement.SupplierSettlementApproval, row.body);

        if (!(yield* approvalUsable(tx, plan, approval))) return yield* failure("ApprovalRequired");
        const id = newId("supplier_receipt");
        yield* Db.insertClaim(tx, command.scope.bookId, plan, id);

        const postingReceipt = yield* executeChangeInTransaction(tx, actor, {
          scope: command.scope,
          changeSetId: plan.paymentPlan.id,
          idempotencyKey: `${id}_posting`,
          input: {
            version: 1,
            planDigest: plan.paymentPlan.planDigest,
            approvalId: approval.paymentApprovalId,
          },
          owner: { kind: "supplier_settlement", id: plan.id },
        });

        if (postingReceipt.voucherId !== plan.reservedVoucherId)
          return yield* failure("InternalError");

        const match = yield* decode(
          Bank.BankMatch,
          yield* addMatch(
            tx,
            command.scope.bookId,
            actor.actorId,
            {
              statementId: plan.input.statementId,
              rowOrdinal: plan.input.rowOrdinal,
              voucherId: postingReceipt.voucherId,
              lineId: plan.bankLineId,
            },
            "explicit",
            plan.id,
          ),
        );

        const allocationReceipt = yield* applyAllocationInTransaction(
          tx,
          actor,
          {
            scope: command.scope,
            id: plan.pendingAllocation.id,
            idempotencyKey: `${id}_allocation`,
            input: {
              version: 1,
              planDigest: plan.pendingAllocation.digest,
              approvalId: approval.allocationApprovalId,
            },
          },
          plan.id,
        );

        const live = (yield* InvoiceDb.readLiveInvoice(
          tx,
          command.scope.bookId,
          plan.input.invoiceId,
        ))[0];

        if (
          !live ||
          live.outstandingMinor !== plan.pendingAllocation.legs[0]?.outstandingAfterMinor
        )
          return yield* failure("InternalError");

        const body = yield* toJsonObject({
          id,
          scope: command.scope,
          planId: plan.id,
          approvalId: approval.id,
          amountMinor: plan.amountMinor,
          outstandingAfterMinor: live.outstandingMinor,
          postingReceipt,
          allocationReceipt,
          match,
          committedAt: yield* isoNow(tx),
          receipt: commandReceipt(command.idempotencyKey, operation, actor.actorId),
        });

        const receipt = yield* decode(Settlement.SupplierSettlementReceipt, {
          ...body,
          digest: yield* digest(body),
        });

        yield* Db.insertReceipt(tx, plan, receipt);
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          actor.actorId,
          yield* toJsonObject(receipt),
        );

        return receipt;
      }),
    );
  },
);

export const getSupplierSettlementReceipt = Effect.fn("purchases.supplierSettlement.receipt")(
  function* (token: string, input: { scope: Scope; receiptId: string }) {
    return yield* owned(token, input.scope, false, null, (tx) =>
      Effect.gen(function* () {
        const receipt = yield* readSettlementReceipt(tx, input.scope, input.receiptId);
        const inverse = (yield* Db.readCancellationReceipt(tx, input.scope.bookId, receipt.id))[0];

        return {
          receipt,
          state: inverse
            ? ("cancelled_unresolved_original_movement" as const)
            : ("settled" as const),
          sourceReusable: false as const,
          cancellation: inverse
            ? yield* decode(Settlement.SupplierSettlementCancellationReceipt, inverse.body)
            : null,
        };
      }),
    );
  },
);

type CancellationPlan = typeof Settlement.SupplierSettlementCancellationPlan.Type;

export const listSupplierSettlementCancellationApprovals = Effect.fn(
  "purchases.supplierSettlement.listCancellationApprovals",
)(function* (token: string, input: { scope: Scope; planId: string; after?: string }) {
  return yield* owned(token, input.scope, false, null, (tx) =>
    Effect.gen(function* () {
      yield* readCancellationPlan(tx, input.scope, input.planId);

      const rows = yield* Db.listCancellationApprovals(
        tx,
        input.scope.bookId,
        input.planId,
        input.after,
      );

      return yield* decode(Settlement.SupplierSettlementCancellationApprovalPage, {
        items: rows
          .slice(0, 25)
          .map((row) => ({ approval: row.approval, revocation: row.revocation })),
        next: rows.length > 25 ? (rows[24]?.id ?? null) : null,
      });
    }),
  );
});

const cancellationBasis = Effect.fn("purchases.supplierSettlement.cancellationBasis")(function* (
  tx: Transaction,
  scope: Scope,
  receipt: typeof Settlement.SupplierSettlementReceipt.Type,
  originalPlan: Plan,
) {
  if (
    (yield* Db.readCancellationReceipt(tx, scope.bookId, receipt.id)).length > 0 ||
    (yield* Db.readLaterSettlement(tx, scope.bookId, receipt.id))[0]?.present
  )
    return yield* failure("StaleDependency");

  const claim = (yield* Db.readClaim(
    tx,
    scope.bookId,
    originalPlan.input.statementId,
    originalPlan.input.rowOrdinal,
  ))[0];

  if (claim?.receiptId !== receipt.id || claim.planId !== originalPlan.id)
    return yield* failure("StaleDependency");
  const period = yield* readPeriod(tx, scope, originalPlan.basis.periodId);

  if (period.locked) return yield* failure("PeriodLocked");

  const impactRows = yield* CorrectionDb.readImpactResources(
    tx,
    scope.bookId,
    receipt.postingReceipt.voucherId,
    originalPlan.basis.observation.date,
  );

  const impactResources = impactRows.map((row) => row.resource);

  if (impactResources.length > 1000) return yield* failure("StaleDependency");

  const consumed = impactResources.find(
    (resource) => resource.kind === "report" || resource.kind === "closing",
  );

  if (consumed)
    return yield* new Accounting.AccountingError({
      code: "StaleDependency",
      message: `Retained ${consumed.kind} ${consumed.id} consumes this settlement. Review ${consumed.path}; this cancellation owner does not support later-consumed corrections.`,
    });

  const live = (yield* InvoiceDb.readLiveInvoice(
    tx,
    scope.bookId,
    originalPlan.input.invoiceId,
  ))[0];

  if (!live) return yield* failure("NotFound");
  const invoice = yield* decode(Commerce.Invoice, live.body);

  if (
    invoice.cashMethod !== undefined ||
    invoice.recognition === null ||
    invoice.status === "blocked" ||
    invoice.controlAccountId !== originalPlan.basis.invoice.controlAccountId ||
    invoice.outstandingMinor === null
  )
    return yield* failure("UnsupportedProfile");

  const settledInvoice = {
    ...originalPlan.basis.invoice,
    allocationVersion: (BigInt(originalPlan.basis.invoice.allocationVersion) + 1n).toString(),
    recordedAllocatedMinor: (
      BigInt(originalPlan.basis.invoice.recordedAllocatedMinor) + BigInt(receipt.amountMinor)
    ).toString(),
    outstandingMinor: receipt.outstandingAfterMinor,
    status: invoice.status,
  };

  if ((yield* canonicalText(invoice)) !== (yield* canonicalText(settledInvoice)))
    return yield* failure("StaleDependency");

  const profileWitness = yield* qualifiedProfile(
    tx,
    scope,
    originalPlan.basis.observation.date,
    originalPlan.basis.source.accountId,
    invoice.controlAccountId,
  );

  return { invoice, profileWitness, impactResources };
});

const readCancellationPlan = Effect.fn("purchases.supplierSettlement.readCancellationPlan")(
  function* (tx: Transaction, scope: Scope, id: string) {
    const row = (yield* Db.readCancellationPlan(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");
    const plan = yield* decode(Settlement.SupplierSettlementCancellationPlan, row.body);

    if (plan.scope.entityId !== scope.entityId) return yield* failure("NotFound");
    const body = Object.fromEntries(Object.entries(plan).filter(([name]) => name !== "digest"));

    if ((yield* digest(yield* toJsonObject(body))) !== plan.digest)
      return yield* failure("StaleDependency");

    return plan;
  },
);

const currentCancellation = Effect.fn("purchases.supplierSettlement.currentCancellation")(
  function* (tx: Transaction, plan: CancellationPlan) {
    if (plan.impactResources === undefined) return yield* failure("StaleDependency");

    const current = yield* cancellationBasis(tx, plan.scope, plan.original, plan.originalPlan).pipe(
      Effect.catchIf(
        (error) =>
          error instanceof Accounting.AccountingError && error.code === "UnsupportedProfile",
        () => Effect.fail(failure("StaleDependency")),
      ),
    );

    if (
      (yield* canonicalText(current)) !==
      (yield* canonicalText({
        invoice: plan.invoice,
        profileWitness: plan.profileWitness,
        impactResources: plan.impactResources,
      }))
    )
      return yield* failure("StaleDependency");
    yield* validatePlan(tx, plan.scope, plan.paymentPlan);
  },
);

export const prepareSupplierSettlementCancellation = Effect.fn(
  "purchases.supplierSettlement.prepareCancellation",
)(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Settlement.PrepareSupplierSettlementCancellation.Type;
  },
) {
  return yield* owned(token, command.scope, false, null, (tx, actor) =>
    Effect.gen(function* () {
      const operation = "prepare_supplier_settlement_cancellation";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        actor.actorId,
        command.input,
        Settlement.SupplierSettlementCancellationPlan,
      );

      if (request.previous) return request.previous;

      const original = yield* readSettlementReceipt(
        tx,
        command.scope,
        command.input.settlementReceiptId,
      );

      const originalPlan = yield* readPlan(tx, command.scope, original.planId);

      if (
        (yield* canonicalText(command.input.evidence)) !==
        (yield* canonicalText(originalPlan.basis.sourceEvidence))
      )
        return yield* failure("StaleDependency");
      const basis = yield* cancellationBasis(tx, command.scope, original, originalPlan);
      const id = newId("supplier_cancellation");

      const paymentPlan = yield* prepareCorrectionInTransaction(tx, actor, {
        scope: command.scope,
        voucherId: original.postingReceipt.voucherId,
        idempotencyKey: `${id}_posting`,
        input: {
          accountingPeriodId: originalPlan.basis.periodId,
          postingDate: originalPlan.basis.observation.date,
          rationale: command.input.reason,
        },
        owner: { kind: "supplier_settlement_cancellation", id: original.id },
      });

      const allocationReversal = yield* prepareAllocationReversalInTransaction(
        tx,
        actor,
        {
          scope: command.scope,
          idempotencyKey: `${id}_allocation`,
          input: { receiptId: original.allocationReceipt.id, reason: command.input.reason },
        },
        original.id,
      );

      const matchReversal = yield* prepareBankMatchReversalInTransaction(
        tx,
        actor,
        {
          scope: command.scope,
          idempotencyKey: `${id}_match`,
          input: {
            target: {
              kind: "exact_match",
              statementId: originalPlan.input.statementId,
              rowOrdinal: originalPlan.input.rowOrdinal,
            },
            reason: command.input.reason,
          },
        },
        original.id,
      );

      const body = yield* toJsonObject({
        id,
        scope: command.scope,
        version: 1,
        input: command.input,
        original,
        originalPlan,
        ...basis,
        paymentPlan,
        allocationReversal,
        matchReversal,
        createdBy: actor.actorId,
        createdAt: yield* isoNow(tx),
        receipt: commandReceipt(command.idempotencyKey, operation, actor.actorId),
      });

      const plan = yield* decode(Settlement.SupplierSettlementCancellationPlan, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertCancellationPlan(tx, plan);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        actor.actorId,
        yield* toJsonObject(plan),
      );

      return plan;
    }),
  );
});

export const approveSupplierSettlementCancellation = Effect.fn(
  "purchases.supplierSettlement.approveCancellation",
)(function* (
  token: string,
  command: {
    scope: Scope;
    planId: string;
    idempotencyKey: string;
    input: typeof Settlement.ApproveSupplierSettlement.Type;
  },
) {
  return yield* owned(token, command.scope, true, command.planId, (tx, actor) =>
    Effect.gen(function* () {
      const operation = "approve_supplier_settlement_cancellation";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        actor.actorId,
        { id: command.planId, input: command.input },
        Settlement.SupplierSettlementCancellationApproval,
      );

      if (request.previous) return request.previous;
      const plan = yield* readCancellationPlan(tx, command.scope, command.planId);

      if (plan.createdBy === actor.actorId) return yield* failure("Forbidden");

      if (plan.digest !== command.input.digest) return yield* failure("StaleDependency");
      yield* currentCancellation(tx, plan);
      const id = newId("supplier_cancel_approval");

      const payment = yield* approveChangeInTransaction(tx, actor, {
        scope: command.scope,
        changeSetId: plan.paymentPlan.id,
        idempotencyKey: `${id}_posting`,
        input: { version: 1, planDigest: plan.paymentPlan.planDigest },
        owner: { kind: "supplier_settlement_cancellation", id: plan.id },
      });

      const allocation = yield* approveAllocationReversalInTransaction(
        tx,
        actor,
        {
          scope: command.scope,
          id: plan.allocationReversal.id,
          idempotencyKey: `${id}_allocation`,
          input: { version: 1, digest: plan.allocationReversal.digest },
        },
        plan.id,
      );

      const match = yield* approveBankMatchReversalInTransaction(
        tx,
        actor,
        {
          scope: command.scope,
          planId: plan.matchReversal.id,
          idempotencyKey: `${id}_match`,
          input: { version: 1, digest: plan.matchReversal.digest },
        },
        plan.id,
      );

      const expiresAt = [payment.expiresAt, allocation.expiresAt, match.expiresAt].sort(
        (a, b) => Date.parse(a) - Date.parse(b),
      )[0];

      if (!expiresAt) return yield* failure("InternalError");

      const approval = yield* decode(Settlement.SupplierSettlementCancellationApproval, {
        id,
        scope: command.scope,
        planId: plan.id,
        version: 1,
        digest: plan.digest,
        actorId: actor.actorId,
        expiresAt,
        paymentApprovalId: payment.id,
        allocationApprovalId: allocation.id,
        matchApprovalId: match.id,
        receipt: commandReceipt(command.idempotencyKey, operation, actor.actorId),
      });

      yield* Db.insertCancellationApproval(tx, approval);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        actor.actorId,
        yield* toJsonObject(approval),
      );

      return approval;
    }),
  );
});

export const revokeSupplierSettlementCancellationApproval = Effect.fn(
  "purchases.supplierSettlement.revokeCancellation",
)(function* (
  token: string,
  command: {
    scope: Scope;
    approvalId: string;
    idempotencyKey: string;
    input: typeof Settlement.RevokeSupplierSettlementApproval.Type;
  },
) {
  return yield* owned(token, command.scope, true, null, (tx, actor) =>
    Effect.gen(function* () {
      const operation = "revoke_supplier_settlement_cancellation_approval";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        actor.actorId,
        { id: command.approvalId, input: command.input },
        Settlement.SupplierSettlementApprovalRevocation,
      );

      if (request.previous) return request.previous;

      const approval = (yield* Db.readCancellationApproval(
        tx,
        command.scope.bookId,
        command.approvalId,
      ))[0];

      if (!approval) return yield* failure("NotFound");

      const existing = (yield* Db.readCancellationRevocation(
        tx,
        command.scope.bookId,
        command.approvalId,
      ))[0];

      const result = existing
        ? yield* decode(Settlement.SupplierSettlementApprovalRevocation, existing.body)
        : {
            approvalId: command.approvalId,
            actorId: actor.actorId,
            reason: command.input.reason,
            revokedAt: yield* isoNow(tx),
            receipt: commandReceipt(command.idempotencyKey, operation, actor.actorId),
          };

      if (!existing) yield* Db.insertCancellationRevocation(tx, command.scope.bookId, result);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        actor.actorId,
        yield* toJsonObject(result),
      );

      return result;
    }),
  );
});

export const executeSupplierSettlementCancellation = Effect.fn(
  "purchases.supplierSettlement.executeCancellation",
)(function* (
  token: string,
  command: {
    scope: Scope;
    planId: string;
    idempotencyKey: string;
    input: typeof Settlement.ExecuteSupplierSettlement.Type;
  },
) {
  return yield* owned(token, command.scope, false, command.planId, (tx, actor) =>
    Effect.gen(function* () {
      const operation = "execute_supplier_settlement_cancellation";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        actor.actorId,
        { id: command.planId, input: command.input },
        Settlement.SupplierSettlementCancellationReceipt,
      );

      if (request.previous) return request.previous;
      const plan = yield* readCancellationPlan(tx, command.scope, command.planId);

      if (plan.digest !== command.input.digest) return yield* failure("StaleDependency");

      if ((yield* Db.readCancellationReceiptByPlan(tx, command.scope.bookId, plan.id)).length > 0)
        return yield* failure("AlreadyPosted");

      yield* currentCancellation(tx, plan);

      const row = (yield* Db.readCancellationApproval(
        tx,
        command.scope.bookId,
        command.input.approvalId,
      ))[0];

      if (!row || row.planId !== plan.id) return yield* failure("ApprovalRequired");

      if ((yield* Db.readCancellationRevocation(tx, command.scope.bookId, row.id)).length > 0)
        return yield* failure("ApprovalRequired");
      const approval = yield* decode(Settlement.SupplierSettlementCancellationApproval, row.body);

      const bindings = (yield* Db.readCancellationApprovalBindings(
        tx,
        command.scope.bookId,
        approval.id,
      ))[0];

      if (
        !bindings ||
        approval.actorId === plan.createdBy ||
        bindings.paymentActorId !== approval.actorId ||
        bindings.allocationActorId !== approval.actorId ||
        bindings.matchActorId !== approval.actorId ||
        bindings.paymentPlanId !== plan.paymentPlan.id ||
        bindings.allocationPlanId !== plan.allocationReversal.id ||
        bindings.matchPlanId !== plan.matchReversal.id ||
        bindings.paymentDigest !== plan.paymentPlan.planDigest ||
        bindings.allocationDigest !== plan.allocationReversal.digest ||
        bindings.matchDigest !== plan.matchReversal.digest
      )
        return yield* failure("ApprovalRequired");

      const membership = yield* LedgerDb.readOperatorMembership(
        tx,
        command.scope.bookId,
        approval.actorId,
      );

      const admission = (yield* LedgerDb.readActorAdmission(tx, approval.actorId))[0];

      const now = Date.parse(yield* isoNow(tx));

      const expired = [
        approval.expiresAt,
        bindings.paymentExpiresAt,
        bindings.allocationExpiresAt,
        bindings.matchExpiresAt,
      ].some((expiry) => !(Date.parse(expiry) > now));

      if (
        approval.digest !== plan.digest ||
        bindings.paymentConsumed ||
        bindings.paymentRevoked ||
        bindings.allocationRevoked ||
        bindings.matchRevoked ||
        expired ||
        membership.length !== 1 ||
        admission?.enabled !== true
      )
        return yield* failure("ApprovalRequired");
      const id = newId("supplier_cancel_receipt");

      const allocationReversal = yield* executeAllocationReversalInTransaction(
        tx,
        actor,
        {
          scope: command.scope,
          id: plan.allocationReversal.id,
          idempotencyKey: `${id}_allocation`,
          input: {
            version: 1,
            digest: plan.allocationReversal.digest,
            approvalId: approval.allocationApprovalId,
          },
        },
        plan.id,
      );

      const matchReversal = yield* executeBankMatchReversalInTransaction(
        tx,
        actor,
        {
          scope: command.scope,
          planId: plan.matchReversal.id,
          idempotencyKey: `${id}_match`,
          input: {
            version: 1,
            digest: plan.matchReversal.digest,
            approvalId: approval.matchApprovalId,
          },
        },
        plan.id,
      );

      const postingReceipt = yield* executeChangeInTransaction(tx, actor, {
        scope: command.scope,
        changeSetId: plan.paymentPlan.id,
        idempotencyKey: `${id}_posting`,
        input: {
          version: 1,
          planDigest: plan.paymentPlan.planDigest,
          approvalId: approval.paymentApprovalId,
        },
        owner: { kind: "supplier_settlement_cancellation", id: plan.id },
      });

      const live = (yield* InvoiceDb.readLiveInvoice(
        tx,
        command.scope.bookId,
        plan.originalPlan.input.invoiceId,
      ))[0];

      const expected = (
        BigInt(plan.invoice.outstandingMinor ?? "0") + BigInt(plan.original.amountMinor)
      ).toString();

      if (!live || live.outstandingMinor !== expected) return yield* failure("InternalError");

      const body = yield* toJsonObject({
        id,
        scope: command.scope,
        planId: plan.id,
        approvalId: approval.id,
        settlementReceiptId: plan.original.id,
        postingReceipt,
        allocationReversal,
        matchReversal,
        outstandingAfterMinor: expected,
        committedAt: yield* isoNow(tx),
        receipt: commandReceipt(command.idempotencyKey, operation, actor.actorId),
      });

      const result = yield* decode(Settlement.SupplierSettlementCancellationReceipt, {
        ...body,
        digest: yield* digest(body),
      });

      yield* Db.insertCancellationReceipt(tx, result);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        actor.actorId,
        yield* toJsonObject(result),
      );

      return result;
    }),
  );
});

const requireUnclaimedSource = Effect.fn("purchases.supplierSettlement.requireUnclaimedSource")(
  function* (
    tx: Transaction,
    scope: Scope,
    input: typeof Settlement.PrepareSupplierSettlement.Type,
  ) {
    if ((yield* Db.readClaim(tx, scope.bookId, input.statementId, input.rowOrdinal)).length > 0)
      return yield* failure("AlreadyPosted");
  },
);

export const listSupplierSettlements = Effect.fn("purchases.supplierSettlement.list")(function* (
  token: string,
  input: { scope: Scope; after?: string },
) {
  return yield* owned(token, input.scope, false, null, (tx) =>
    Effect.gen(function* () {
      const rows = yield* Db.listRetainedPlans(tx, input.scope.bookId, input.after);
      const items = rows.slice(0, 25);

      return yield* decode(Settlement.SupplierSettlementDiscovery, {
        items,
        next: rows.length > 25 ? (items[24]?.id ?? null) : null,
      });
    }),
  );
});

export const getSupplierSettlementCancellation = Effect.fn(
  "purchases.supplierSettlement.getCancellation",
)(function* (token: string, input: { scope: Scope; planId: string }) {
  return yield* owned(token, input.scope, false, null, (tx) =>
    Effect.gen(function* () {
      const plan = yield* readCancellationPlan(tx, input.scope, input.planId);
      const stored = (yield* Db.readCancellationReceiptByPlan(tx, input.scope.bookId, plan.id))[0];

      return {
        plan,
        receipt: stored
          ? yield* decode(Settlement.SupplierSettlementCancellationReceipt, stored.body)
          : null,
      };
    }),
  );
});
