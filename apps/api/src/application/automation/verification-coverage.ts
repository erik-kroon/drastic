import * as Accounting from "@open-erp/contracts/accounting";
import * as Wire from "@open-erp/contracts/verification-coverage";
import * as Coverage from "@open-erp/domain/verification-coverage";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { sql } from "drizzle-orm";
import { withTransaction, type Transaction } from "../../db/transaction";
import { admitPrincipal } from "../../db/identity";
import * as Db from "../../db/verification-coverage";
import * as WorkspaceDb from "../../db/workspace";
import * as LedgerDb from "../../db/posting";
import * as BankDb from "../../db/banking/shared";
import { getBankInventorySignoffInTransaction } from "../banking/inventory-signoffs";
import { getBankSourceCoverageInTransaction } from "../banking/coverage";
import { getBankCapacityReconciliationInTransaction } from "../banking/reconciliations";
import { getActualReturnInTransaction } from "../vat/actual-return";
import { decode, toJsonObject, requireTableAccess } from "../commerce/support";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { failure } from "../failures";

type Scope = typeof Accounting.Scope.Type;

type Selection = typeof Wire.CaptureClosePredicate.Type;

type Record = typeof Coverage.CheckRecord.Type;

type View = typeof Coverage.CheckView.Type;

type Month = typeof Coverage.FrozenMonth.Type;

const reportedChecks = [
  { checkId: "tax_account_control", reason: "tax_account_coverage_not_established" },
  { checkId: "subledger_control", reason: "subledger_control_not_reconciled" },
  {
    checkId: "supplier_statement_control",
    reason: "independent_supplier_statement_owner_not_released",
  },
  {
    checkId: "customer_statement_control",
    reason: "independent_customer_statement_owner_not_released",
  },
  { checkId: "closing_provider_control", reason: "closing_provider_coverage_not_established" },
] as const;

const absentReasons = {
  bank_reconciliation: "bank_check_not_captured",
  vouchers_supported: "voucher_support_owner_not_released",
  facts_complete: "complete_fact_owner_not_released",
  reviews_and_questions: "operational_inventory_not_captured",
  vat_control: "actual_vat_control_not_captured",
} as const;

function snapshot<A, E>(
  token: string,
  scope: Scope,
  write: boolean,
  use: (
    tx: Transaction,
    principal: import("../../db/identity").VerifiedPrincipal,
  ) => Effect.Effect<A, E>,
) {
  return withTransaction((tx) =>
    Effect.gen(function* () {
      yield* tx.execute(sql`set transaction isolation level repeatable read`);

      const principal = yield* admitPrincipal(
        tx,
        { token },
        scope,
        { operatorOnly: write },
        write ? "update" : "share",
      );

      yield* requireTableAccess(tx, ["close_predicate_captures", "command_receipts"], write);

      return yield* use(tx, principal);
    }),
  ).pipe(Effect.retry({ times: 2, while: (error) => error.code === "TransactionRetry" }));
}

function readPeriod(tx: Transaction, scope: Scope, periodId: string) {
  return Effect.gen(function* () {
    const period = (yield* LedgerDb.readPeriod(tx, scope.bookId, periodId))[0];

    if (!period) return yield* failure("NotFound");

    return {
      id: period.id,
      fiscalYearId: period.fiscalYearId,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      version: period.version.toString(),
    };
  });
}

function requireMonth(period: Month) {
  return Coverage.monthBounds(period.startsOn, period.endsOn)
    ? Effect.void
    : Effect.fail(
        new Accounting.AccountingError({
          code: "InvalidJournal",
          message: "calendar_month_period_required",
          recovery: Accounting.failureRecovery("InvalidJournal"),
        }),
      );
}

function sameMonth(a: Month, b: Month) {
  return (
    a.id === b.id &&
    a.fiscalYearId === b.fiscalYearId &&
    a.startsOn === b.startsOn &&
    a.endsOn === b.endsOn &&
    a.version === b.version
  );
}

function record(
  id: Record["checkId"],
  status: Record["status"],
  sequence: string,
  reasons: ReadonlyArray<string>,
  dependencies: Record["observedCutoff"]["dependencyDigests"],
  refs: Record["evidenceRefs"],
  facts: Record["facts"],
): Record {
  return {
    checkId: id,
    status,
    reasons,
    observedCutoff: { ledgerSequence: sequence, dependencyDigests: dependencies },
    builderVersion: Coverage.builderVersion,
    evidenceRefs: refs,
    facts,
  };
}

function unavailable(id: Record["checkId"], reason: string, sequence: string) {
  return record(id, "not_established", sequence, [reason], {}, [], {});
}

function currentView(
  retained: Record,
  fresh: boolean,
  reasons: ReadonlyArray<string> = [],
  dependencies: Record["observedCutoff"]["dependencyDigests"] = {},
  observedBookSequence?: string,
): View {
  return {
    checkId: retained.checkId,
    status: retained.status,
    reasons: retained.reasons,
    retained,
    evidenceRefs: retained.evidenceRefs,
    freshness: {
      observedBookSequence,
      status:
        retained.status === "not_established" || retained.status === "not_run"
          ? "unavailable"
          : fresh
            ? "fresh"
            : "stale",
      reasons,
      dependencyDigests: dependencies,
    },
  };
}

function operational(tx: Transaction, scope: Scope, period: Month, sequence: string) {
  return Effect.gen(function* () {
    const attention = (yield* WorkspaceDb.readCloseAttentionInventory(
      tx,
      scope.bookId,
      period.startsOn,
      period.endsOn,
    ))[0];

    const questions = (yield* Db.readQuestionInventory(tx, scope.bookId))[0];

    if (!attention || !questions) return yield* failure("InternalError");
    const refs = yield* decode(importRefsSchema, { refs: [...attention.refs, ...questions.refs] });
    const open = attention.open !== "0" || questions.unresolved !== "0";

    return record(
      "reviews_and_questions",
      questions.incomplete !== "0" ? "not_established" : open ? "fail" : "pass",
      sequence,
      questions.incomplete !== "0"
        ? ["question_inventory_incomplete"]
        : open
          ? ["open_reviews_or_questions"]
          : [],
      { attention: attention.digest, questions: questions.digest },
      refs.refs,
      {
        scope: "period_attention_and_book_wide_latest_questions",
        attentionTotal: attention.total,
        openReviews: attention.open,
        questionTotal: questions.total,
        incompleteQuestionHeads: questions.incomplete,
        unresolvedQuestions: questions.unresolved,
      },
    );
  });
}

const importRefsSchema = Schema.Struct({ refs: Schema.Array(Coverage.EvidenceRef) });

function matchingWindow(id: string, startsOn: string, endsOn: string, period: Month) {
  return id === period.id && startsOn === period.startsOn && endsOn === period.endsOn;
}

function bankSourceFacts(
  source:
    | typeof import("@open-erp/contracts/bank-source-coverage").BankSourceCoverageView.Type
    | null,
) {
  return {
    coverageScope: "whole_declared_bank_inventory",
    companyCompleteness: "not_established",
    sourceCoverageHasReviewGaps: source?.report.hasReviewGaps ?? null,
    sourceCoverageDependenciesCurrent: source?.dependenciesCurrent ?? null,
    declaredAccountCount:
      source?.report.accounts.filter((account) => account.declared).length ?? null,
    sourceCoverageDiagnostics: source
      ? [
          ...source.report.diagnostics,
          ...source.report.accounts.flatMap((account) => account.diagnostics),
          ...source.report.accounts.flatMap((account) =>
            account.statements.flatMap((statement) => statement.diagnostics),
          ),
        ]
      : null,
    sourceGapCount:
      source?.report.accounts.reduce((n, account) => n + account.gaps.length, 0) ?? null,
    sourceOverlapCount:
      source?.report.accounts.reduce((n, account) => n + account.overlaps.length, 0) ?? null,
  };
}

function bank(
  tx: Transaction,
  scope: Scope,
  period: Month,
  selection: Selection,
  sequence: string,
) {
  return Effect.gen(function* () {
    const plan =
      selection.bankInventoryPlanId === null
        ? null
        : yield* getBankInventorySignoffInTransaction(tx, {
            scope,
            planId: selection.bankInventoryPlanId,
          });

    const coverageId = selection.bankSourceCoverageReportId ?? null;

    const source =
      coverageId === null
        ? null
        : yield* getBankSourceCoverageInTransaction(tx, { scope, reportId: coverageId });

    if (plan && !matchingWindow(plan.plan.periodId, plan.plan.startsOn, plan.plan.endsOn, period))
      return yield* failure("InvalidJournal");

    if (
      source &&
      !matchingWindow(
        source.report.period.id,
        source.report.input.startsOn,
        source.report.input.endsOn,
        period,
      )
    )
      return yield* failure("InvalidJournal");

    if (plan && source && plan.plan.inventory.id !== source.report.inventory.id)
      return yield* failure("InvalidJournal");
    const refs: Record["evidenceRefs"][number][] = [];
    const dependencies: { [name: string]: string } = {};

    const facts = bankSourceFacts(source);

    let fresh = true;
    const stale: string[] = [];

    if (source) {
      refs.push({
        owner: "bank_source_coverage",
        id: source.report.id,
        digest: source.report.digest,
      });
      dependencies.retainedSourceCoverage = source.report.dependencyDigest;

      if (!source.dependenciesCurrent) {
        fresh = false;
        stale.push("bank_source_coverage_dependency_changed");
      }
    }

    if (plan) {
      refs.push({ owner: "bank_inventory_signoff", id: plan.plan.id, digest: plan.plan.digest });
      dependencies.retainedInventory = plan.plan.basis.dependencyDigest;
      dependencies.retainedMembers = plan.plan.basis.memberDigest;
      const components: Schema.Json[] = [];

      for (const member of plan.plan.members) {
        const found = yield* getBankCapacityReconciliationInTransaction(tx, {
          scope,
          reconciliationId: member.plan.input.reconciliationId,
        });

        if (
          found.report.accountId !== member.accountId ||
          found.report.startsOn !== period.startsOn ||
          found.report.endsOn !== period.endsOn
        )
          return yield* failure("InvalidJournal");
        refs.push({
          owner: "bank_capacity_reconciliation",
          id: found.report.id,
          digest: member.plan.basis.reconciliationDigest,
        });
        dependencies[`observedReconciliation_${member.accountId}`] = yield* digest({
          sourceRevision: found.currentSourceRevision,
          accountLedgerSequence: found.currentAccountLedgerSequence,
        });
        components.push({
          id: found.report.id,
          accountId: member.accountId,
          current: found.fresh,
          sourceRevision: found.currentSourceRevision,
          accountLedgerSequence: found.currentAccountLedgerSequence,
          status: found.report.status,
        });

        if (!found.fresh) {
          fresh = false;
          stale.push("bank_reconciliation_dependency_changed");
        }
      }

      if (!plan.dependenciesCurrent) {
        fresh = false;
        stale.push("bank_inventory_dependency_changed");
      }

      const status =
        plan.signoff === null || source?.report.hasReviewGaps === true ? "fail" : "pass";

      return currentView(
        record(
          "bank_reconciliation",
          status,
          plan.plan.basis.ledgerSequence,
          status === "pass"
            ? []
            : [
                plan.signoff === null
                  ? "bank_inventory_not_signed"
                  : "bank_source_coverage_incomplete",
              ],
          dependencies,
          refs,
          {
            ...facts,
            declaredAccountCount: plan.plan.members.length,
            inventorySigned: plan.signoff !== null,
            inventoryDependenciesCurrent: plan.dependenciesCurrent,
            reconciliationComponents: components,
          },
        ),
        fresh,
        stale,
        dependencies,
        sequence,
      );
    }

    if (source)
      return currentView(
        record(
          "bank_reconciliation",
          "fail",
          source.report.sequence,
          [
            source.report.hasReviewGaps
              ? "bank_source_coverage_incomplete"
              : "whole_bank_inventory_signoff_missing",
          ],
          dependencies,
          refs,
          facts,
        ),
        fresh,
        stale,
        dependencies,
        sequence,
      );

    return currentView(
      record(
        "bank_reconciliation",
        "not_run",
        sequence,
        [absentReasons.bank_reconciliation],
        {},
        [],
        {},
      ),
      false,
      ["bank_check_not_captured"],
    );
  });
}

function vat(tx: Transaction, scope: Scope, period: Month, selection: Selection, sequence: string) {
  return Effect.gen(function* () {
    if (selection.actualVatReturnId === null)
      return currentView(
        record("vat_control", "not_run", sequence, [absentReasons.vat_control], {}, [], {}),
        false,
      );

    const view = yield* getActualReturnInTransaction(tx, {
      scope,
      id: selection.actualVatReturnId,
    });

    const saved = view.saved;

    if (saved.input.startsOn !== period.startsOn || saved.input.endsOn !== period.endsOn)
      return yield* failure("InvalidJournal");
    const calculation = saved.calculation;

    const reasons = [
      ...(!calculation.calculationSupported ? ["vat_calculation_unsupported"] : []),
      ...(!calculation.coverageComplete ? ["vat_coverage_incomplete"] : []),
      ...(!calculation.controlsReconciled ? ["vat_controls_not_reconciled"] : []),
      ...(!calculation.periodVerified ? ["vat_period_not_verified"] : []),
    ];

    const deps = { retainedBasis: saved.calculation.basisDigest, retainedReturn: saved.digest };

    return currentView(
      record(
        "vat_control",
        reasons.length === 0 ? "pass" : "fail",
        saved.basis.ledgerBoundary,
        reasons,
        deps,
        [{ owner: "actual_vat_return", id: saved.id, digest: saved.digest }],
        {
          calculationSupported: calculation.calculationSupported,
          coverageComplete: calculation.coverageComplete,
          controlsReconciled: calculation.controlsReconciled,
          periodVerified: calculation.periodVerified,
          includedCount: calculation.includedCount,
          excludedCount: calculation.excludedCount,
          assessedCount: calculation.assessedCount,
        },
      ),
      view.currentness.basisCurrent,
      view.currentness.staleReasons,
      deps,
      sequence,
    );
  });
}

function compose(
  tx: Transaction,
  scope: Scope,
  period: Month,
  selection: Selection,
  sequence: string,
) {
  return Effect.gen(function* () {
    const bankView = yield* bank(tx, scope, period, selection, sequence);
    const op = yield* operational(tx, scope, period, sequence);
    const vatView = yield* vat(tx, scope, period, selection, sequence);

    return {
      gated: [
        bankView,
        currentView(
          unavailable("vouchers_supported", absentReasons.vouchers_supported, sequence),
          false,
        ),
        currentView(unavailable("facts_complete", absentReasons.facts_complete, sequence), false),
        currentView(op, true, [], op.observedCutoff.dependencyDigests, sequence),
        vatView,
      ],
      reported: reportedChecks.map(({ checkId, reason }) =>
        currentView(unavailable(checkId, reason, sequence), false),
      ),
    };
  });
}

function capturedView(
  tx: Transaction,
  scope: Scope,
  capture: typeof Wire.CloseCapture.Type,
  currentPeriod: Month,
  sequence: string,
) {
  return Effect.gen(function* () {
    const current = yield* compose(tx, scope, capture.period, capture.selection, sequence);

    const gated = capture.gated.map((retained) => {
      const now = current.gated.find((check) => check.checkId === retained.checkId);

      if (!now) return currentView(retained, false, ["check_builder_unavailable"]);
      let fresh = now.freshness.status === "fresh";
      const reasons = [...now.freshness.reasons];

      if (!sameMonth(currentPeriod, capture.period)) {
        fresh = false;
        reasons.push("period_dependency_changed");
      }

      if (
        retained.checkId === "reviews_and_questions" &&
        (retained.observedCutoff.dependencyDigests.attention !==
          now.retained?.observedCutoff.dependencyDigests.attention ||
          retained.observedCutoff.dependencyDigests.questions !==
            now.retained?.observedCutoff.dependencyDigests.questions)
      ) {
        fresh = false;
        reasons.push("operational_inventory_changed");
      }

      return currentView(retained, fresh, reasons, now.freshness.dependencyDigests, sequence);
    });

    return yield* decode(Wire.ClosePredicate, {
      scope,
      period: capture.period,
      capture,
      gated,
      reported: capture.reported.map((item) => currentView(item, false)),
      verdict: Coverage.closeVerdict(gated),
    });
  });
}

export const captureClosePredicate = Effect.fn("coverage.capture")(function* (
  token: string,
  command: { scope: Scope; periodId: string; idempotencyKey: string; input: Selection },
) {
  return yield* snapshot(token, command.scope, true, (tx, principal) =>
    Effect.gen(function* () {
      const selection = {
        bankInventoryPlanId: command.input.bankInventoryPlanId,
        bankSourceCoverageReportId: command.input.bankSourceCoverageReportId ?? null,
        actualVatReturnId: command.input.actualVatReturnId,
      };

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "capture_close_predicate",
        principal.actorId,
        { id: command.periodId, input: selection },
        Wire.ClosePredicate,
      );

      if (request.previous !== undefined) return request.previous;
      const period = yield* readPeriod(tx, command.scope, command.periodId);
      yield* requireMonth(period);
      const book = (yield* BankDb.lockBook(tx, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");
      const observed = yield* compose(tx, command.scope, period, selection, book.committedSequence);

      const gated = observed.gated.flatMap((view) =>
        view.retained === null ? [] : [view.retained],
      );

      const reported = observed.reported.flatMap((view) =>
        view.retained === null ? [] : [view.retained],
      );

      const basis = {
        id: newId("close_capture"),
        scope: command.scope,
        period,
        builderVersion: Coverage.builderVersion,
        selection,
        gated,
        reported,
        inventoryDigest: yield* digest({ gated, reported }),
        createdAt: yield* isoNow(tx),
        receipt: {
          key: command.idempotencyKey,
          operation: "capture_close_predicate" as const,
          actorId: principal.actorId,
        },
      };

      const capture = yield* decode(Wire.CloseCapture, { ...basis, digest: yield* digest(basis) });

      const inserted = yield* Db.insertCapture(tx, {
        bookId: command.scope.bookId,
        id: capture.id,
        periodId: period.id,
        key: command.idempotencyKey,
        actorId: principal.actorId,
        digest: capture.digest,
        body: yield* toJsonObject(capture),
      });

      if (inserted.length === 0) return yield* failure("TransactionRetry");

      const result = yield* decode(Wire.ClosePredicate, {
        scope: command.scope,
        period,
        capture,
        gated: observed.gated,
        reported: observed.reported,
        verdict: Coverage.closeVerdict(observed.gated),
      });

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "capture_close_predicate",
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    }),
  );
});

export const getClosePredicate = Effect.fn("coverage.read")(function* (
  token: string,
  command: { scope: Scope; periodId: string; captureId?: string },
) {
  return yield* snapshot(token, command.scope, false, (tx) =>
    Effect.gen(function* () {
      const period = yield* readPeriod(tx, command.scope, command.periodId);

      const stored = (yield* Db.readCapture(
        tx,
        command.scope.bookId,
        command.periodId,
        command.captureId,
      ))[0];

      if (command.captureId !== undefined && !stored) return yield* failure("NotFound");

      if (stored) {
        const capture = yield* decode(Wire.CloseCapture, stored.body);
        const book = (yield* BankDb.lockBook(tx, command.scope.bookId, "share"))[0];

        if (!book) return yield* failure("Forbidden");

        return yield* capturedView(tx, command.scope, capture, period, book.committedSequence);
      }

      yield* requireMonth(period);

      const gated = Coverage.gatedCheckIds.map((checkId) => ({
        checkId,
        status:
          checkId === "vouchers_supported" || checkId === "facts_complete"
            ? ("not_established" as const)
            : ("not_run" as const),
        reasons: [absentReasons[checkId]],
        retained: null,
        evidenceRefs: [],
        freshness: {
          status: "unavailable" as const,
          reasons: ["not_captured"],
          dependencyDigests: {},
        },
      }));

      const reported = reportedChecks.map(({ checkId, reason }) => ({
        checkId,
        status: "not_established",
        reasons: [reason],
        retained: null,
        evidenceRefs: [],
        freshness: { status: "unavailable", reasons: ["not_captured"], dependencyDigests: {} },
      }));

      return yield* decode(Wire.ClosePredicate, {
        scope: command.scope,
        period,
        capture: null,
        gated,
        reported,
        verdict: Coverage.closeVerdict(gated),
      });
    }),
  );
});
