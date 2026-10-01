import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Settlement from "@open-erp/contracts/supplier-settlements";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/purchases/supplier-settlements";
import * as LedgerDb from "../../db/posting";
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
    row.providerId === null &&
    BigInt(row.amountMinor) < 0n
  );
}

const captureBasis = Effect.fn("purchases.supplierSettlement.captureBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Settlement.PrepareSupplierSettlement.Type,
) {
  const book = yield* readBook(tx, scope);

  if (
    book.profile !== "synthetic-core-v1" ||
    book.authority !== "native" ||
    book.currency !== "SEK" ||
    book.currencyScale !== 2
  )
    return yield* failure("UnsupportedProfile");
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
  const current = yield* captureBasis(tx, plan.scope, plan.input);

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
            payment.expiresAt < allocation.expiresAt ? payment.expiresAt : allocation.expiresAt,
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
    approval.expiresAt <= (yield* isoNow(tx))
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
    admission?.enabled === false ||
    payment.consumedAt !== null ||
    payment.changeSetId !== plan.paymentPlan.id ||
    allocation.planId !== plan.pendingAllocation.id ||
    payment.actorId !== approval.actorId ||
    allocation.actorId !== approval.actorId ||
    payment.digest !== plan.paymentPlan.planDigest ||
    allocation.digest !== plan.pendingAllocation.digest ||
    payment.expiresAt <= (yield* isoNow(tx)) ||
    allocation.expiresAt <= (yield* isoNow(tx)) ||
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
        paymentPosted: false as const,
        executionAvailable: false as const,
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
