import * as SupplierSettlementDb from "../db/purchases/supplier-settlements";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Db from "../db/posting-admission";
import * as PayrollRuns from "../db/payroll/runs";
import * as Impact from "../db/posting-corrections";
import * as Schedules from "../db/subledger/schedules";
import * as Acceptance from "../db/purchases/acceptance";
import type { Transaction } from "../db/transaction";
import { failure } from "./failures";
import { isoNow } from "./posting";
import { readPostingBasis } from "./subledger/schedules";
import { ownerRequireReady, validateOwnerLine } from "./subledger/owners";
import { decode, objectField, textField, type JsonObject, type Scope } from "./commerce/support";

// Only an owning application operation can supply this context. It is never part
// of a transport contract, stored plan, credential or queue payload.
export type PostingOwner = {
  readonly kind:
    | "invoice_issue"
    | "invoice_cancellation"
    | "legal_issue"
    | "legal_credit"
    | "supplier_settlement"
    | "supplier_settlement_cancellation"
    | "supplier_acceptance"
    | "supplier_credit"
    | "supplier_refund"
    | "service_purchase"
    | "financial_close"
    | "vat_assessment"
    | "asset_disposal"
    | "asset_impairment"
    | "asset_valuation"
    | "historical_import"
    | "commerce_fx"
    | "vat_reclassification"
    | "corporate_income_tax"
    | "customer_receipt"
    | "owner_operation"
    | "cash_allocation"
    | "cash_year_end"
    | "cash_credit"
    | "payroll_run";
  readonly id: string;
};

export const admitPosting = Effect.fn("posting.admitOwnedSources")(function* (
  tx: Transaction,
  scope: Scope,
  changeId: string,
  action: JsonObject,
  owner?: PostingOwner,
) {
  const eventId = textField(action, "eventId"),
    year = textField(action, "fiscalYearId"),
    date = textField(action, "postingDate");

  if (!eventId || !year || !date || !Array.isArray(action.evidenceRefs))
    return yield* failure("InvalidJournal");

  // A close freezes cumulative BS balances, including earlier open years. The
  // owning transfer precedes its certificate in the same transaction; replay
  // precedes admission, and an approved successful reopen releases this fence.
  if ((yield* Db.readActiveCloseCoveringDate(tx, scope.bookId, date)).length > 0)
    return yield* failure("StaleDependency");

  if (action.foreignCurrency !== undefined && owner?.kind !== "commerce_fx")
    return yield* failure("UnsupportedProfile");

  if (
    action.postingPurpose === "vat_control_reclassification_v1" &&
    owner?.kind !== "vat_reclassification"
  )
    return yield* failure("UnsupportedProfile");

  if (action.postingPurpose === "legal_ar_recognition" && owner?.kind !== "legal_issue")
    return yield* failure("UnsupportedProfile");

  if (action.postingPurpose === "legal_customer_credit_v1" && owner?.kind !== "legal_credit")
    return yield* failure("UnsupportedProfile");

  if (action.postingPurpose === "result_transfer_v1" && owner?.kind !== "financial_close")
    return yield* failure("UnsupportedProfile");

  yield* admitPayrollRun(tx, scope, changeId, owner, action);

  yield* admitSupplierSettlement(tx, scope, changeId, eventId, action, owner);

  yield* admitVatAssessment(tx, scope, eventId, action, owner);

  if (
    action.postingPurpose === "adjustment" &&
    (yield* Db.readRecurringCapacity(tx, scope.bookId, eventId)).some(
      (r) => BigInt(r.amount) !== 0n,
    )
  )
    return yield* failure("StaleDependency");

  yield* admitSources(tx, scope, changeId, eventId, action, owner);
  yield* admitHistoricalPosting(tx, scope, year, changeId, date, owner);
  yield* admitCorrectionsAndSchedules(tx, scope, changeId, eventId, date, action, owner);

  for (const link of yield* Db.readOwnerAttachments(tx, scope.bookId, changeId, eventId)) {
    if (!link.reviewId || link.linkReviewId !== link.reviewId || !link.lineId)
      return yield* failure("StaleDependency");

    const ready = yield* ownerRequireReady(tx, scope, link.recordId, link.reviewId, false);

    if (link.revisionDigest !== ready.digest) return yield* failure("StaleDependency");

    yield* validateOwnerLine(tx, scope, ready, action, link.lineId);
  }
});

const admitVatAssessment = Effect.fn("posting.admitVatAssessment")(function* (
  tx: Transaction,
  scope: Scope,
  eventId: string,
  action: JsonObject,
  owner?: PostingOwner,
) {
  const rows = yield* Db.readVatAssessmentPosting(tx, scope.bookId, eventId);
  const row = rows[0];

  if (!row && owner?.kind !== "vat_assessment") return;

  if (owner?.kind !== "vat_assessment") return yield* failure("ApprovalRequired");

  if (!row || rows.length !== 1) return yield* failure("StaleDependency");

  const retained = yield* decode(
    Schema.Struct({
      id: Accounting.Identifier,
      evidence: Schema.Struct({ evidenceId: Accounting.Identifier }),
      plan: Schema.Struct({
        journal: Schema.Array(
          Schema.Struct({
            accountId: Accounting.Identifier,
            debitMinor: Accounting.MinorUnits,
            creditMinor: Accounting.MinorUnits,
          }),
        ),
      }),
    }),
    row.body,
  );

  const proposed = yield* decode(
    Schema.Struct({
      lines: Schema.Array(
        Schema.Struct({
          accountId: Accounting.Identifier,
          debitMinor: Accounting.MinorUnits,
          creditMinor: Accounting.MinorUnits,
        }),
      ),
    }),
    action,
  );

  if (
    action.postingPurpose !== "adjustment" ||
    owner.id !== retained.id ||
    row.evidenceId !== retained.evidence.evidenceId ||
    ![`vat_bridge_${retained.id}`, `vat_assessment_${retained.id}`].includes(row.eventKey) ||
    !equalJson(proposed.lines, retained.plan.journal)
  )
    return yield* failure("StaleDependency");
});

function matchesCreditedOriginal(
  source: { readonly kind: string; readonly id: string; readonly body: JsonObject },
  original: JsonObject | null,
  action: JsonObject,
) {
  return (
    source.kind === "legal_issue" &&
    original !== null &&
    source.id === textField(original, "reviewId") &&
    textField(source.body, "digest") === textField(original, "reviewDigest") &&
    textField(objectField(action, "legalCredit"), "originalIssueId") === textField(original, "id")
  );
}

const matchesCashOriginal = Effect.fn("posting.matchesCashOriginal")(function* (
  source: { readonly kind: string; readonly id: string; readonly body: JsonObject },
  retained: { readonly kind: string; readonly body: JsonObject } | undefined,
  owner: PostingOwner | undefined,
  eventId: string,
) {
  if (source.kind !== "cash_invoice" || !retained) return false;

  if (owner?.kind === "cash_credit" && retained.kind === "cash_credit") {
    const plan = yield* decode(CashMethod.CashCreditPlan, retained.body);

    return (
      plan.selection.eventId === eventId &&
      plan.selection.input.invoiceId === source.id &&
      equalJson(plan.selection.basis, objectField(source.body, "cashMethod"))
    );
  }

  if (owner?.kind === "cash_year_end" && retained.kind === "cash_year_end") {
    const plan = yield* decode(CashMethod.CashYearEndPlan, retained.body);

    return (
      plan.selection.eventId === eventId &&
      plan.selection.invoices.some(
        (invoice) =>
          invoice.invoiceId === source.id &&
          equalJson(invoice.basis, objectField(source.body, "cashMethod")),
      )
    );
  }

  if (owner?.kind !== "cash_allocation" || retained.kind !== "cash_allocation") return false;

  const effect = yield* decode(CashMethod.CashAllocationPrepared, retained.body);

  return (
    effect.selection.source.eventId === eventId &&
    effect.selection.invoices.some(
      (invoice) =>
        invoice.invoiceId === source.id &&
        equalJson(invoice.basis, objectField(source.body, "cashMethod")),
    )
  );
});

const admitSources = Effect.fn("posting.admitSources")(function* (
  tx: Transaction,
  scope: Scope,
  changeId: string,
  eventId: string,
  action: JsonObject,
  owner?: PostingOwner,
) {
  const evidence = sourceEvidenceIds(action);

  const ownership = yield* Db.readOwnedSources(tx, scope.bookId, changeId, eventId, evidence);

  if (ownership.length > 1000) return yield* failure("UnsupportedProfile");

  const retained = ownership.find((r) => r.kind === owner?.kind && r.id === owner?.id);

  const creditOriginal =
    owner?.kind === "legal_credit" && retained
      ? objectField(retained.body, "originalSnapshot")
      : null;

  for (const source of ownership) {
    if (source.kind === "invoice_issue" && owner?.kind === "invoice_cancellation") continue;

    // A credit must cite its own original issue. This exception binds the exact
    // reviewed original; it does not admit unrelated issue evidence or a new sale.
    if (matchesCreditedOriginal(source, creditOriginal, action)) continue;

    if (yield* matchesCashOriginal(source, retained, owner, eventId)) continue;

    if (yield* matchesSupersededAcceptance(tx, scope, source, ownership, retained, owner, eventId))
      continue;

    if (source.kind !== owner?.kind) return yield* failure("ApprovalRequired");
  }

  if (ownership.length && owner?.kind !== "invoice_cancellation")
    yield* admitSealedOwner(retained, changeId, action);
});

function sourceEvidenceIds(action: JsonObject) {
  return (Array.isArray(action.evidenceRefs) ? action.evidenceRefs : []).flatMap((ref) =>
    typeof ref === "object" &&
    ref !== null &&
    !Array.isArray(ref) &&
    typeof ref.evidenceId === "string"
      ? [ref.evidenceId]
      : [],
  );
}

type OwnedSource = {
  readonly kind: string;
  readonly id: string;
  readonly changeId: string | null;
  readonly body: JsonObject;
};

const matchesSupersededAcceptance = Effect.fn("posting.matchesSupersededAcceptance")(function* (
  tx: Transaction,
  scope: Scope,
  source: OwnedSource,
  ownership: ReadonlyArray<OwnedSource>,
  retained: OwnedSource | undefined,
  owner: PostingOwner | undefined,
  eventId: string,
) {
  if (
    source.kind !== "supplier_acceptance" ||
    !source.changeId ||
    !(
      owner?.kind === "cash_allocation" ||
      owner?.kind === "cash_year_end" ||
      owner?.kind === "cash_credit"
    )
  )
    return false;

  const evidenceId = textField(objectField(source.body, "evidence"), "evidenceId");

  const original = ownership.find(
    (candidate) =>
      candidate.kind === "cash_invoice" &&
      textField(objectField(candidate.body, "evidence"), "evidenceId") === evidenceId,
  );

  if (!evidenceId || !original || !(yield* matchesCashOriginal(original, retained, owner, eventId)))
    return false;

  // The receipt test remains mandatory: executed acceptance is never superseded.
  return (
    (yield* Acceptance.readReviewByChangeSet(tx, scope.bookId, source.changeId))[0]?.present ===
    false
  );
});

const admitSealedOwner = Effect.fn("posting.admitSealedOwner")(function* (
  retained: OwnedSource | undefined,
  changeId: string,
  action: JsonObject,
) {
  if (!retained) return yield* failure("StaleDependency");

  if (retained.kind !== "legal_issue" && retained.kind !== "legal_credit") {
    const plan = objectField(retained.body, "postingPlan");

    if (retained.changeId !== changeId || !Array.isArray(plan.groups))
      return yield* failure("StaleDependency");

    const first = plan.groups[0];

    if (
      typeof first !== "object" ||
      first === null ||
      Array.isArray(first) ||
      !Array.isArray(first.actions) ||
      !equalJson(first.actions[0], action)
    )
      return yield* failure("StaleDependency");
  } else if (retained.kind === "legal_issue") {
    if (textField(objectField(action, "legalIssue"), "reviewId") !== retained.id)
      return yield* failure("StaleDependency");
  } else if (textField(objectField(action, "legalCredit"), "reviewId") !== retained.id)
    return yield* failure("StaleDependency");
});

const admitHistoricalPosting = Effect.fn("posting.admitHistoricalPosting")(function* (
  tx: Transaction,
  scope: Scope,
  year: string,
  changeId: string,
  date: string,
  owner?: PostingOwner,
) {
  const state = (yield* Db.readHistoricalPostingState(tx, scope.bookId, year, changeId))[0];

  if (!state) return yield* failure("InternalError");

  if (state.superseded) return yield* failure("StaleDependency");

  const basis = state.basis;

  if (basis?.mode === "opening_set") {
    if (basis.change_set_id === changeId) {
      if (basis.opening_voucher_id !== null || date !== basis.cutover_on)
        return yield* failure("AlreadyPosted");
    } else if (basis.opening_voucher_id === null || date < (textField(basis, "cutover_on") ?? ""))
      return yield* failure("ApprovalRequired");
  }

  const now = Date.parse(yield* isoNow(tx));

  for (const run of state.runs) {
    if (
      owner?.kind !== "historical_import" ||
      owner.id !== run.id ||
      !(Date.parse(textField(run, "leaseUntil") ?? "") > now)
    )
      return yield* failure("StaleDependency");
  }

  for (const proposal of state.proposals) {
    if (
      owner?.kind !== "historical_import" ||
      proposal.runId !== owner.id ||
      proposal.posted === true ||
      !state.runs.some((r) => r.id === owner.id)
    )
      return yield* failure("StaleDependency");
  }
});

const admitCorrectionsAndSchedules = Effect.fn("posting.admitCorrectionsAndSchedules")(function* (
  tx: Transaction,
  scope: Scope,
  changeId: string,
  eventId: string,
  date: string,
  action: JsonObject,
  owner?: PostingOwner,
) {
  yield* admitScheduleEvent(tx, scope, eventId);

  const cancellationRows =
    owner?.kind === "supplier_settlement_cancellation"
      ? yield* SupplierSettlementDb.readCancellationPlan(tx, scope.bookId, owner.id)
      : [];

  const cancellation = cancellationRows[0]?.body;

  const exactCancellation =
    cancellation !== undefined &&
    textField(objectField(cancellation, "paymentPlan"), "id") === changeId &&
    textField(objectField(objectField(cancellation, "original"), "postingReceipt"), "voucherId") ===
      textField(action, "correctsVoucherId");

  const original = textField(action, "correctsVoucherId");

  if (original) {
    const protectedRows = yield* Db.readProtectedCorrections(tx, scope.bookId, original);

    if (
      protectedRows.some(
        (r) =>
          !(
            (owner?.kind === "commerce_fx" && r.kind === "fx_settlement") ||
            (exactCancellation && r.kind === "supplier_settlement")
          ),
      )
    )
      return yield* failure("UnsupportedProfile");

    const impacts = yield* Impact.readImpactResources(tx, scope.bookId, original, date);

    if (
      impacts.length > 1000 ||
      impacts.some(
        ({ resource }) =>
          resource.blocks &&
          !(owner?.kind === "invoice_cancellation" && resource.kind === "invoice") &&
          !(
            exactCancellation &&
            cancellation !== undefined &&
            ((resource.kind === "bank_match" &&
              resource.id ===
                textField(
                  objectField(objectField(cancellation, "original"), "match"),
                  "statementId",
                )) ||
              (resource.kind === "payment_allocation" &&
                resource.id ===
                  textField(
                    objectField(objectField(cancellation, "original"), "allocationReceipt"),
                    "id",
                  )))
          ),
      )
    )
      return yield* failure("UnsupportedProfile");
  } else {
    const preparation = (yield* Db.readSchedulePreparation(tx, scope.bookId, changeId))[0];

    if (preparation) {
      const row = (yield* Schedules.readCurrentRevision(
        tx,
        scope.bookId,
        preparation.scheduleId,
      ))[0];

      if (!row) return yield* failure("StaleDependency");

      const revision = yield* decode(Subledgers.ScheduleRevision, row.body);
      const current = yield* readPostingBasis(tx, scope, revision);

      if (
        !current.supported ||
        revision.revision !== preparation.revision ||
        !(
          equalJson(preparation.basis, current) ||
          (preparation.basis === null && current.mode === "standalone_synthetic")
        )
      )
        return yield* failure("StaleDependency");
    } else if ((yield* Db.readLinkedScheduleEvents(tx, scope.bookId, changeId, eventId)).length)
      return yield* failure("StaleDependency");
  }
});

const admitSupplierSettlement = Effect.fn("posting.admitSupplierSettlement")(function* (
  tx: Transaction,
  scope: Scope,
  changeId: string,
  eventId: string,
  action: JsonObject,
  owner?: PostingOwner,
) {
  const settlementSources = yield* SupplierSettlementDb.readPlansByEvent(tx, scope.bookId, eventId);

  if (settlementSources.length > 0) {
    const child =
      owner?.kind === "supplier_settlement"
        ? settlementSources.find((row) => row.id === owner.id)
        : undefined;

    const inverse =
      owner?.kind === "supplier_settlement_cancellation"
        ? (yield* SupplierSettlementDb.readCancellationPlan(tx, scope.bookId, owner.id))[0]
        : undefined;

    const retained = child?.body ?? inverse?.body;

    if (!retained || textField(objectField(retained, "paymentPlan"), "id") !== changeId)
      return yield* failure("ApprovalRequired");
    const plan = yield* decode(Accounting.ChangeSet, objectField(retained, "paymentPlan"));

    if (!equalJson(plan.groups[0]?.actions[0], action)) return yield* failure("StaleDependency");
  }
});

export const admitScheduleEvent = Effect.fn("posting.admitScheduleEvent")(function* (
  tx: Transaction,
  scope: Scope,
  eventId: string,
) {
  if ((yield* Db.readRetiredScheduleEvent(tx, scope.bookId, eventId)).length)
    return yield* failure("StaleDependency");
});

export const admitPayrollRun = Effect.fn("posting.admitPayrollRun")(function* (
  tx: Transaction,
  scope: Scope,
  changeId: string,
  owner?: PostingOwner,
  action?: JsonObject,
) {
  const row = (yield* PayrollRuns.readRunByPlan(
    tx,
    scope.bookId,
    changeId,
    action && textField(action, "eventId"),
  ))[0];

  if (!row && owner?.kind !== "payroll_run") return;

  if (!row || owner?.kind !== "payroll_run" || owner.id !== row.id)
    return yield* failure("ApprovalRequired");
  const plan = yield* decode(Accounting.ChangeSet, objectField(row.body, "postingPlan"));

  if (plan.id !== changeId) return yield* failure("ApprovalRequired");

  if (action !== undefined && !equalJson(plan.groups[0]?.actions[0], action))
    return yield* failure("StaleDependency");
});
