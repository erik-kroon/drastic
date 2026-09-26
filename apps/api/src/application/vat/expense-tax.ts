import * as ExpenseTax from "@open-erp/contracts/expense-tax";
import * as Effect from "effect/Effect";
import * as Db from "../../db/posting";
import { databaseFailure, type Transaction } from "../../db/transaction";
import * as AssessmentDb from "../../db/vat/expense-tax-assessment";
import * as ExpenseDb from "../../db/vat/expense-tax";
import {
  decode,
  toJsonObject,
  unsupported,
  type JsonObject,
  type Principal,
  type Scope,
} from "../commerce/support";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode } from "../identity";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { digestBody, digestValue } from "./basis";

type SourceRevision = typeof ExpenseTax.TaxSourceRevision.Type;
type SourceReview = typeof ExpenseTax.TaxReview.Type;
type ReviewInput = typeof ExpenseTax.ReviewTaxSource.Type;
type WithdrawalInput = typeof ExpenseTax.WithdrawTaxSource.Type;
type SnapshotInput = typeof ExpenseTax.PrepareTaxSnapshot.Type;
type Blocker = (typeof ExpenseTax.TaxAssessment.fields.blockers.Type)[number];

const SourceRevisionSchema = ExpenseTax.TaxSourceRevision;
const SourceReviewSchema = ExpenseTax.TaxReview;
const WithdrawalSchema = ExpenseTax.TaxSourceWithdrawal;
const SourceViewSchema = ExpenseTax.TaxSourceView;
const InventorySchema = ExpenseTax.TaxInventory;
const SnapshotSchema = ExpenseTax.TaxSnapshot;
const SnapshotViewSchema = ExpenseTax.TaxSnapshotView;
const SnapshotPageSchema = ExpenseTax.TaxSnapshotPage;

const sourceBound = 200;
const sourceRevisionBound = 20;
const reviewRevisionBound = 100;
const snapshotPageBound = 25;
const snapshotMembershipBound = 200;
const maximumMinorUnits = 10n ** 38n;

const calculationBlockingReasons: ReadonlyArray<Blocker> = [
  "withdrawn_source",
  "duplicate_source_component",
  "ambiguous_voucher_sources",
  "wrong_record_class",
  "missing_currency",
  "foreign_currency",
  "missing_jurisdiction",
  "foreign_supply",
  "registration_unknown_or_unsupported",
  "method_unknown_or_unsupported",
  "unsupported_treatment",
  "missing_review_dates",
  "missing_source_dates",
  "date_difference",
  "outside_interval",
  "missing_deduction_basis",
  "invalid_deduction_fraction",
];

const writableTables = new Set([
  "expense_tax_sources",
  "expense_tax_source_revisions",
  "expense_tax_reviews",
  "expense_tax_source_withdrawals",
  "expense_tax_snapshots",
  "command_receipts",
]);

function withExpenseTaxBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function requireExpenseAccess(transaction: Transaction, write: boolean) {
  return ExpenseDb.readExpenseTaxAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== ExpenseDb.expenseTaxTables.length) return unsupported();
      const denied = rows.some((row) => {
        if (!row.canSelect) return true;
        return write && writableTables.has(row.tableName) && !row.canInsert;
      });
      return denied ? unsupported() : Effect.void;
    }),
  );
}

function optionalMinor(value: string | null) {
  return value === null ? null : BigInt(value);
}

function difference(left: bigint | null, right: bigint | null) {
  if (left === null || right === null) return null;
  return (left - right).toString();
}

function readBasis(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const book = (yield* ExpenseDb.readBookState(transaction, bookId))[0];
    if (book === undefined) return yield* failure("Forbidden");
    const sources = yield* ExpenseDb.readBasisSources(transaction, bookId);
    if (sources.length > sourceBound) return yield* unsupported();
    return yield* digestValue(transaction, {
      bookId,
      currency: book.currency,
      currencyScale: book.currencyScale,
      profile: book.profile,
      profileVersion: book.profileVersion,
      sources: sources.map((row) => row.item),
    });
  });
}

export const recordSource = Effect.fn("expenseTax.recordSource")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof ExpenseTax.RecordTaxSource.Type;
  },
) {
  return yield* withExpenseTaxBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "record_expense_tax_source",
          principal.actorId,
          payload,
          SourceRevisionSchema,
        );
        if (request.previous) return request.previous;
        yield* requireExpenseAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const facts = yield* toJsonObject(command.input.facts);
        const evidence = (
          yield* Db.readEvidence(transaction, command.scope.bookId, command.input.facts.evidenceId)
        )[0];
        const evidenceSha256 = evidence?.sha256;
        if (evidenceSha256 === undefined) return yield* failure("MissingEvidence");
        if (command.input.facts.changeSetId !== null) {
          const plan = (
            yield* ExpenseDb.readPlan(
              transaction,
              command.scope.bookId,
              command.input.facts.changeSetId,
            )
          )[0];
          if (plan === undefined || !citesEvidence(plan.plan, command.input.facts.evidenceId)) {
            return yield* failure("MissingEvidence");
          }
        }
        if (command.input.facts.voucherId !== null) {
          const voucher = (
            yield* ExpenseDb.readVoucherAction(
              transaction,
              command.scope.bookId,
              command.input.facts.voucherId,
              command.input.facts.changeSetId,
            )
          )[0];
          if (voucher === undefined || !citesEvidence(voucher.action, command.input.facts.evidenceId)) {
            return yield* failure("MissingEvidence");
          }
        }
        const existing = (
          yield* ExpenseDb.readSourceByKey(
            transaction,
            command.scope.bookId,
            command.input.sourceKey,
          )
        )[0];
        let sourceId: string;
        let revision = 1;
        let previousDigest: string | null = null;
        if (existing !== undefined) {
          const current = (
            yield* ExpenseDb.readCurrentRevision(transaction, command.scope.bookId, existing.id, "update")
          )[0];
          if (current === undefined) return yield* failure("NotFound");
          if (current.body.digest !== command.input.expectedSourceDigest) {
            return yield* failure("StaleDependency");
          }
          if (existing.recordClass !== command.input.facts.recordClass) {
            return yield* failure("InvalidJournal");
          }
          sourceId = existing.id;
          revision = current.revision + 1;
          previousDigest = current.body.digest;
          if (revision > sourceRevisionBound) return yield* unsupported();
        } else {
          if (command.input.expectedSourceDigest !== null) {
            return yield* failure("StaleDependency");
          }
          const count = yield* ExpenseDb.readSourceCount(transaction, command.scope.bookId);
          if ((count[0]?.total ?? 0) >= sourceBound) return yield* unsupported();
          sourceId = newId("taxsource");
          yield* ExpenseDb.insertSource(transaction, {
            bookId: command.scope.bookId,
            id: sourceId,
            sourceKey: command.input.sourceKey,
            recordClass: command.input.facts.recordClass,
          });
        }
        const body = yield* digestBody(transaction, {
          id: newId("taxsourceversion"),
          sourceId,
          sourceKey: command.input.sourceKey,
          revision,
          previousDigest,
          scope: command.scope,
          facts,
          evidenceSha256,
          recordedAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "record_expense_tax_source",
            actorId: principal.actorId,
          },
        });
        const result = yield* decode(SourceRevisionSchema, body);
        yield* ExpenseDb.insertRevision(transaction, {
          bookId: command.scope.bookId,
          sourceId,
          revision,
          id: result.id,
          evidenceId: command.input.facts.evidenceId,
          changeSetId: command.input.facts.changeSetId,
          voucherId: command.input.facts.voucherId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "record_expense_tax_source",
          principal.actorId,
          result,
        );
        return result;
      }),
    "update",
  );
});

function isJsonRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function citesEvidence(action: JsonObject, evidenceId: string) {
  const groups = action.groups;
  if (!Array.isArray(groups)) return false;
  for (const group of groups) {
    if (!isJsonRecord(group)) continue;
    const actions = group.actions;
    if (!Array.isArray(actions)) continue;
    for (const entry of actions) {
      if (!isJsonRecord(entry)) continue;
      const refs = entry.evidenceRefs;
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (isJsonRecord(ref) && ref.evidenceId === evidenceId) return true;
      }
    }
  }
  return false;
}

export const withdrawSource = Effect.fn("expenseTax.withdrawSource")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: WithdrawalInput },
) {
  return yield* withExpenseTaxBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "withdraw_expense_tax_source",
          principal.actorId,
          payload,
          WithdrawalSchema,
        );
        if (request.previous) return request.previous;
        yield* requireExpenseAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const current = (
          yield* ExpenseDb.readCurrentRevision(
            transaction,
            command.scope.bookId,
            command.id,
            "update",
          )
        )[0];
        if (current === undefined) return yield* failure("NotFound");
        if (current.body.digest !== command.input.expectedSourceDigest) {
          return yield* failure("StaleDependency");
        }
        if (
          (yield* ExpenseDb.readWithdrawal(transaction, command.scope.bookId, command.id))[0] !==
          undefined
        ) {
          return yield* failure("StaleDependency");
        }
        const evidence = (
          yield* Db.readEvidence(transaction, command.scope.bookId, command.input.evidenceId)
        )[0];
        const evidenceSha256 = evidence?.sha256;
        if (evidenceSha256 === undefined) return yield* failure("MissingEvidence");
        const body = yield* digestBody(transaction, {
          id: newId("expensewithdrawal"),
          scope: command.scope,
          sourceId: command.id,
          revisionId: current.id,
          revision: current.revision,
          revisionDigest: current.body.digest,
          input: command.input,
          evidenceSha256,
          permanent: true,
          recordedAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "withdraw_expense_tax_source",
            actorId: principal.actorId,
          },
        });
        const withdrawal = yield* decode(WithdrawalSchema, body);
        yield* ExpenseDb.insertWithdrawal(transaction, {
          bookId: command.scope.bookId,
          sourceId: command.id,
          revision: current.revision,
          id: withdrawal.id,
          evidenceId: command.input.evidenceId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "withdraw_expense_tax_source",
          principal.actorId,
          withdrawal,
        );
        return withdrawal;
      }),
    "update",
  );
});

export const reviewSource = Effect.fn("expenseTax.reviewSource")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: ReviewInput },
) {
  return yield* withExpenseTaxBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "review_expense_tax_source",
          principal.actorId,
          payload,
          SourceReviewSchema,
        );
        if (request.previous) return request.previous;
        yield* requireExpenseAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const current = (
          yield* ExpenseDb.readCurrentRevision(transaction, command.scope.bookId, command.id, "update")
        )[0];
        if (current === undefined) return yield* failure("NotFound");
        const source = yield* decode(SourceRevisionSchema, current.body);
        const retained = (
          yield* ExpenseDb.readLatestReview(transaction, command.scope.bookId, command.id)
        )[0];
        const review = retained === undefined ? null : yield* decode(SourceReviewSchema, retained.body);
        if (
          source.digest !== command.input.sourceDigest ||
          (review?.digest ?? null) !== command.input.expectedReviewDigest
        ) {
          return yield* failure("StaleDependency");
        }
        const cited = [
          command.input.facts.evidenceId,
          command.input.facts.registrationEvidenceId,
          command.input.facts.methodEvidenceId,
          command.input.facts.dateEvidenceId,
          command.input.facts.deductionEvidenceId,
        ].filter((value): value is string => value !== null);
        const digests = new Map(
          (yield* ExpenseDb.readEvidenceDigests(transaction, command.scope.bookId, cited)).map(
            (row) => [row.id, row.sha256],
          ),
        );
        if (cited.some((id) => !digests.has(id))) return yield* failure("MissingEvidence");
        const revision = (review?.revision ?? 0) + 1;
        if (revision > reviewRevisionBound) return yield* unsupported();
        const body = yield* digestBody(transaction, {
          id: newId("taxreview"),
          sourceId: command.id,
          revision,
          sourceDigest: source.digest,
          previousDigest: review?.digest ?? null,
          scope: command.scope,
          facts: yield* toJsonObject(command.input.facts),
          evidenceRefs: cited
            .map((id) => ({ evidenceId: id, sha256: digests.get(id) ?? "" }))
            .sort((left, right) => (left.evidenceId < right.evidenceId ? -1 : 1)),
          authority: "operator_fact_review_only",
          recordedAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "review_expense_tax_source",
            actorId: principal.actorId,
          },
        });
        const result = yield* decode(SourceReviewSchema, body);
        yield* ExpenseDb.insertReview(transaction, {
          bookId: command.scope.bookId,
          sourceId: command.id,
          revision,
          sourceRevision: source.revision,
          id: result.id,
          evidenceId: command.input.facts.evidenceId,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "review_expense_tax_source",
          principal.actorId,
          result,
        );
        return result;
      }),
    "update",
  );
});

export const getSource = Effect.fn("expenseTax.getSource")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withExpenseTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireExpenseAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const current = (
        yield* ExpenseDb.readCurrentRevision(transaction, command.scope.bookId, command.id)
      )[0];
      if (current === undefined) return yield* failure("NotFound");
      const revision = yield* decode(SourceRevisionSchema, current.body);
      const retained = (
        yield* ExpenseDb.readLatestReview(transaction, command.scope.bookId, command.id)
      )[0];
      const latestReview =
        retained === undefined ? null : yield* decode(SourceReviewSchema, retained.body);
      const withdrawal = (
        yield* ExpenseDb.readWithdrawal(transaction, command.scope.bookId, command.id)
      )[0];
      const withdrawn = withdrawal === undefined ? null : yield* decode(WithdrawalSchema, withdrawal.body);
      const sources = yield* ExpenseDb.readRevisionHistory(
        transaction,
        command.scope.bookId,
        command.id,
      );
      const reviews = yield* ExpenseDb.readReviewHistory(
        transaction,
        command.scope.bookId,
        command.id,
      );
      return yield* decode(SourceViewSchema, {
        withdrawal: withdrawn,
        current: revision,
        latestReview,
        reviewCurrent:
          withdrawn === null && latestReview?.sourceDigest === revision.digest,
        sourceHistory: yield* Effect.forEach(sources, (row) =>
          decode(SourceRevisionSchema, row.body),
        ),
        reviewHistory: yield* Effect.forEach(reviews, (row) =>
          decode(SourceReviewSchema, row.body),
        ),
      });
    }),
  );
});

export const inventory = Effect.fn("expenseTax.inventory")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withExpenseTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireExpenseAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const count = yield* ExpenseDb.readSourceCount(transaction, command.scope.bookId);
      if ((count[0]?.total ?? 0) > sourceBound) return yield* unsupported();
      const rows = yield* ExpenseDb.readCurrentInventory(transaction, command.scope.bookId);
      const sources: Array<JsonObject> = [];
      for (const row of rows) {
        const item = row.item;
        const current = item.current;
        const latest = item.latestReview;
        const withdrawn = item.withdrawal;
        if (!isJsonRecord(current)) return yield* failure("InternalError");
        const currentDigest = current.digest;
        const reviewCurrent =
          withdrawn === undefined && isJsonRecord(latest) && latest.sourceDigest === currentDigest;
        sources.push(
          yield* toJsonObject({
            current,
            latestReview: latest ?? null,
            withdrawal: withdrawn ?? null,
            reviewCurrent,
          }),
        );
      }
      return yield* decode(InventorySchema, {
        basisDigest: yield* readBasis(transaction, command.scope.bookId),
        observedAt: yield* isoNow(transaction),
        coverageEstablished: false,
        sources,
      });
    }),
  );
});

type Assessment = typeof ExpenseTax.TaxAssessment.Type;

type SourceBlockers = {
  readonly gross: bigint | null;
  readonly net: bigint | null;
  readonly vat: bigint | null;
  readonly blockers: ReadonlyArray<Blocker>;
};

function readSourceBlockers(
  book: { readonly profile: string; readonly currency: string; readonly currencyScale: number },
  selection: SnapshotInput,
  source: SourceRevision,
  context: { readonly withdrawn: boolean; readonly duplicate: boolean; readonly ambiguous: boolean },
): SourceBlockers {
  const blockers: Array<Blocker> = [];
  if (context.withdrawn) {
    blockers.push("withdrawn_source");
  } else {
    if (context.duplicate) blockers.push("duplicate_source_component");
    if (context.ambiguous) blockers.push("ambiguous_voucher_sources");
  }
  const facts = source.facts;
  const gross = optionalMinor(facts.amounts.grossMinor);
  const net = optionalMinor(facts.amounts.netMinor);
  const vat = optionalMinor(facts.amounts.vatMinor);
  if (gross === null || net === null || vat === null) blockers.push("missing_source_amounts");
  if (gross !== null && net !== null && vat !== null && gross - net - vat !== 0n) {
    blockers.push("source_amount_difference");
  }
  if (
    (selection.mode === "synthetic_demonstration" && facts.recordClass !== "synthetic") ||
    (selection.mode === "actual_review" && facts.recordClass !== "actual_company")
  ) {
    blockers.push("wrong_record_class");
  }
  if (selection.mode === "actual_review") blockers.push("production_profile_unapproved");
  if (facts.currency === null || facts.currencyScale === null) {
    blockers.push("missing_currency");
  } else if (facts.currency !== book.currency || facts.currencyScale !== book.currencyScale) {
    blockers.push("foreign_currency");
  }
  if (facts.issuedOn === null || facts.receivedOn === null) {
    blockers.push("missing_source_dates");
  }
  return { gross, net, vat, blockers };
}

type ReviewBlockers = {
  readonly gross: bigint | null;
  readonly net: bigint | null;
  readonly vat: bigint | null;
  readonly blockers: ReadonlyArray<Blocker>;
};

function readReviewAmountBlockers(
  source: SourceRevision,
  review: SourceReview,
  sourceAmounts: SourceBlockers,
) {
  const blockers: Array<Blocker> = [];
  const gross = optionalMinor(review.facts.amounts.grossMinor);
  const net = optionalMinor(review.facts.amounts.netMinor);
  const vat = optionalMinor(review.facts.amounts.vatMinor);
  if (review.sourceDigest !== source.digest) blockers.push("stale_review");
  if (gross === null || net === null || vat === null) blockers.push("missing_review_amounts");
  if (gross !== null && net !== null && vat !== null && gross - net - vat !== 0n) {
    blockers.push("review_amount_difference");
  }
  if (
    (gross !== null && sourceAmounts.gross !== null && gross !== sourceAmounts.gross) ||
    (net !== null && sourceAmounts.net !== null && net !== sourceAmounts.net) ||
    (vat !== null && sourceAmounts.vat !== null && vat !== sourceAmounts.vat)
  ) {
    blockers.push("source_review_difference");
  }
  return { gross, net, vat, blockers };
}

function readJurisdictionBlockers(
  source: SourceRevision,
  review: SourceReview,
  selection: SnapshotInput,
) {
  const blockers: Array<Blocker> = [];
  const facts = review.facts;
  if (
    source.facts.supplierJurisdiction === null ||
    source.facts.supplyJurisdiction === null ||
    facts.bookJurisdiction == null
  ) {
    blockers.push("missing_jurisdiction");
  } else if (
    source.facts.supplierJurisdiction !== facts.bookJurisdiction ||
    source.facts.supplyJurisdiction !== facts.bookJurisdiction
  ) {
    blockers.push("foreign_supply");
  }
  if (facts.registration !== "registered" || facts.registrationEvidenceId == null) {
    blockers.push("registration_unknown_or_unsupported");
  }
  if (facts.method !== "accrual" || facts.methodEvidenceId == null) {
    blockers.push("method_unknown_or_unsupported");
  }
  if (facts.treatment !== "domestic_purchase") blockers.push("unsupported_treatment");
  if (
    facts.suppliedOn == null ||
    facts.taxPointOn == null ||
    facts.dateBasis == null ||
    facts.dateEvidenceId == null
  ) {
    blockers.push("missing_review_dates");
  }
  if (
    (source.facts.suppliedOn !== null && source.facts.suppliedOn !== facts.suppliedOn) ||
    (source.facts.taxPointOn !== null && source.facts.taxPointOn !== facts.taxPointOn)
  ) {
    blockers.push("date_difference");
  }
  if (
    facts.taxPointOn != null &&
    (facts.taxPointOn < selection.startsOn || facts.taxPointOn > selection.endsOn)
  ) {
    blockers.push("outside_interval");
  }
  return blockers;
}

function readProfileBlockers(
  book: { readonly profile: string },
  review: SourceReview,
) {
  const blockers: Array<Blocker> = [];
  if (
    review.facts.profileId !== "synthetic-expense-tax" ||
    review.facts.profileVersion !== "1" ||
    book.profile !== "synthetic-core-v1"
  ) {
    blockers.push("unsupported_profile");
  }
  return blockers;
}

function readRateBlockers(review: SourceReview) {
  const blockers: Array<Blocker> = [];
  const facts = review.facts;
  const rateNumerator = optionalMinor(facts.rateNumerator);
  const rateDenominator = optionalMinor(facts.rateDenominator);
  const deductionNumerator = optionalMinor(facts.deductionNumerator);
  const deductionDenominator = optionalMinor(facts.deductionDenominator);
  if (rateNumerator === null || rateDenominator === null) blockers.push("missing_rate");
  if (
    deductionNumerator === null ||
    deductionDenominator === null ||
    facts.deductionBasis == null ||
    facts.deductionEvidenceId == null
  ) {
    blockers.push("missing_deduction_basis");
  }
  if (
    deductionNumerator !== null &&
    deductionDenominator !== null &&
    deductionNumerator > deductionDenominator
  ) {
    blockers.push("invalid_deduction_fraction");
  }
  if (facts.roundingPolicy !== "exact_only") blockers.push("rounding_policy_unavailable");
  return blockers;
}

function readReviewBlockers(
  book: { readonly profile: string },
  selection: SnapshotInput,
  source: SourceRevision,
  review: SourceReview,
  sourceAmounts: SourceBlockers,
): ReviewBlockers {
  const amounts = readReviewAmountBlockers(source, review, sourceAmounts);
  return {
    gross: amounts.gross,
    net: amounts.net,
    vat: amounts.vat,
    blockers: [
      ...amounts.blockers,
      ...readProfileBlockers(book, review),
      ...readJurisdictionBlockers(source, review, selection),
      ...readRateBlockers(review),
    ],
  };
}


type ExactAmounts = {
  readonly tax: bigint | null;
  readonly deductible: bigint | null;
  readonly nonDeductible: bigint | null;
  readonly expense: bigint | null;
  readonly calculation: typeof ExpenseTax.TaxCalculation.Type | null;
};

function isExactCalculationEligible(
  book: { readonly profile: string },
  selection: SnapshotInput,
  source: SourceRevision,
  review: SourceReview,
  blockers: ReadonlyArray<Blocker>,
  net: bigint | null,
  rateNumerator: bigint | null,
  rateDenominator: bigint | null,
) {
  const facts = review.facts;
  if (selection.mode !== "synthetic_demonstration") return false;
  if (source.facts.recordClass !== "synthetic") return false;
  if (facts.profileId !== "synthetic-expense-tax" || facts.profileVersion !== "1") return false;
  if (book.profile !== "synthetic-core-v1") return false;
  if (review.sourceDigest !== source.digest) return false;
  if (facts.roundingPolicy !== "exact_only") return false;
  if (blockers.some((blocker) => calculationBlockingReasons.includes(blocker))) return false;
  return net !== null && rateNumerator !== null && rateDenominator !== null;
}

type DeductionSplit = {
  readonly product: bigint | null;
  readonly remainder: bigint | null;
  readonly deductible: bigint | null;
  readonly nonDeductible: bigint | null;
  readonly expense: bigint | null;
};

function readDeductionAmounts(
  tax: bigint,
  gross: bigint | null,
  deductionNumerator: bigint | null,
  deductionDenominator: bigint | null,
  blockers: Array<Blocker>,
): DeductionSplit {
  const absent: DeductionSplit = {
    product: null,
    remainder: null,
    deductible: null,
    nonDeductible: null,
    expense: null,
  };
  if (
    deductionNumerator === null ||
    deductionDenominator === null ||
    deductionNumerator > deductionDenominator
  ) {
    return absent;
  }
  const product = tax * deductionNumerator;
  const remainder = product % deductionDenominator;
  if (remainder !== 0n) {
    blockers.push("fractional_deduction");
    return { product, remainder, deductible: null, nonDeductible: null, expense: null };
  }
  const deductible = product / deductionDenominator;
  const nonDeductible = tax - deductible;
  const expense = (gross ?? 0n) - deductible;
  if (expense < 0n) {
    blockers.push("calculated_tax_difference");
    return { product, remainder, deductible, nonDeductible, expense: null };
  }
  return { product, remainder, deductible, nonDeductible, expense };
}

type ExactResult = {
  readonly amounts: ExactAmounts;
  readonly blockers: ReadonlyArray<Blocker>;
};

function readExactAmounts(
  book: { readonly profile: string },
  selection: SnapshotInput,
  source: SourceRevision,
  review: SourceReview,
  reviewAmounts: ReviewBlockers,
  blockers: ReadonlyArray<Blocker>,
): ExactResult {
  const facts = review.facts;
  const rateNumerator = optionalMinor(facts.rateNumerator);
  const rateDenominator = optionalMinor(facts.rateDenominator);
  const deductionNumerator = optionalMinor(facts.deductionNumerator);
  const deductionDenominator = optionalMinor(facts.deductionDenominator);
  const eligible = isExactCalculationEligible(
    book,
    selection,
    source,
    review,
    blockers,
    reviewAmounts.net,
    rateNumerator,
    rateDenominator,
  );
  const absent: ExactAmounts = {
    tax: null,
    deductible: null,
    nonDeductible: null,
    expense: null,
    calculation: null,
  };
  if (!eligible || rateNumerator === null || rateDenominator === null) {
    return { amounts: absent, blockers: [] };
  }
  if (reviewAmounts.net === null) return { amounts: absent, blockers: [] };
  const exact: Array<Blocker> = [];
  const taxProduct = reviewAmounts.net * rateNumerator;
  const taxRemainder = taxProduct % rateDenominator;
  let tax: bigint | null = null;
  let deductible: bigint | null = null;
  let nonDeductible: bigint | null = null;
  let expense: bigint | null = null;
  let deductionProduct: bigint | null = null;
  let deductionRemainder: bigint | null = null;
  if (taxRemainder !== 0n) {
    exact.push("fractional_tax");
  } else if (taxProduct / rateDenominator >= maximumMinorUnits) {
    exact.push("amount_out_of_range");
  } else {
    tax = taxProduct / rateDenominator;
    if ((reviewAmounts.vat ?? 0n) - tax !== 0n) exact.push("calculated_tax_difference");
    const split = readDeductionAmounts(
      tax,
      reviewAmounts.gross,
      deductionNumerator,
      deductionDenominator,
      exact,
    );
    deductionProduct = split.product;
    deductionRemainder = split.remainder;
    deductible = split.deductible;
    nonDeductible = split.nonDeductible;
    expense = split.expense;
  }
  return {
    amounts: {
      tax,
      deductible,
      nonDeductible,
      expense,
      calculation: {
        taxProductNumerator: taxProduct.toString(),
        rateDenominator: rateDenominator.toString(),
        taxRemainder: taxRemainder.toString(),
        calculatedVatMinor: tax?.toString() ?? null,
        deductionProductNumerator: deductionProduct?.toString() ?? null,
        deductionDenominator:
          deductionDenominator === null ? null : deductionDenominator.toString(),
        deductionRemainder: deductionRemainder?.toString() ?? null,
        deductibleMinor: deductible?.toString() ?? null,
        nonDeductibleMinor: nonDeductible?.toString() ?? null,
        expenseMinor: expense?.toString() ?? null,
      },
    },
    blockers: exact,
  };
}

function assess(
  book: { readonly profile: string; readonly currency: string; readonly currencyScale: number },
  selection: SnapshotInput,
  source: SourceRevision,
  review: SourceReview | null,
  context: { readonly withdrawn: boolean; readonly duplicate: boolean; readonly ambiguous: boolean },
) {
  return Effect.gen(function* () {
    const sourceAmounts = readSourceBlockers(book, selection, source, context);
    const reviewAmounts =
      review === null ? null : readReviewBlockers(book, selection, source, review, sourceAmounts);
    const blockers = [
      ...sourceAmounts.blockers,
      ...(reviewAmounts === null ? (["missing_review"] as const) : reviewAmounts.blockers),
    ];
    const exact =
      review === null || reviewAmounts === null
        ? null
        : readExactAmounts(book, selection, source, review, reviewAmounts, blockers);
    const allBlockers = [...blockers, ...(exact?.blockers ?? [])];
    const reviewGross = reviewAmounts?.gross ?? null;
    const reviewNet = reviewAmounts?.net ?? null;
    const reviewVat = reviewAmounts?.vat ?? null;
    const tax = exact?.amounts.tax ?? null;
    const deductible = exact?.amounts.deductible ?? null;
    const nonDeductible = exact?.amounts.nonDeductible ?? null;
    const expense = exact?.amounts.expense ?? null;
    const unique = [...new Set(allBlockers)].sort();
    const contribution = buildContribution(unique.length, {
      gross: reviewGross,
      net: reviewNet,
      tax,
      deductible,
      nonDeductible,
      expense,
    });
    if (unique.length === 0 && contribution === null) {
      return yield* failure("InvalidJournal");
    }
    return yield* decode(ExpenseTax.TaxAssessment, {
      state: contribution === null ? "excluded" : "included_synthetic",
      blockers: unique,
      controls: {
        sourceBalanceDifferenceMinor: balanceOf(sourceAmounts.gross, sourceAmounts.net, sourceAmounts.vat),
        reviewBalanceDifferenceMinor: balanceOf(reviewGross, reviewNet, reviewVat),
        grossDifferenceMinor: difference(reviewGross, sourceAmounts.gross),
        netDifferenceMinor: difference(reviewNet, sourceAmounts.net),
        vatDifferenceMinor: difference(reviewVat, sourceAmounts.vat),
        calculatedVatDifferenceMinor: difference(reviewVat, tax),
      },
      calculation: exact?.amounts.calculation ?? null,
      contribution,
    });
  });
}

type ContributionParts = {
  readonly gross: bigint | null;
  readonly net: bigint | null;
  readonly tax: bigint | null;
  readonly deductible: bigint | null;
  readonly nonDeductible: bigint | null;
  readonly expense: bigint | null;
};

function buildContribution(
  blockerCount: number,
  parts: ContributionParts,
): typeof ExpenseTax.TaxContribution.Type | null {
  if (blockerCount > 0) return null;
  const gross = parts.gross;
  const net = parts.net;
  const tax = parts.tax;
  const deductible = parts.deductible;
  const nonDeductible = parts.nonDeductible;
  const expense = parts.expense;
  if (
    gross === null ||
    tax === null ||
    deductible === null ||
    nonDeductible === null ||
    expense === null
  ) {
    return null;
  }
  if (nonDeductible + deductible !== tax || expense + deductible !== gross) return null;
  return {
    grossMinor: gross.toString(),
    netMinor: (net ?? 0n).toString(),
    vatMinor: tax.toString(),
    deductibleMinor: deductible.toString(),
    nonDeductibleMinor: nonDeductible.toString(),
    expenseMinor: expense.toString(),
  };
}

function balanceOf(gross: bigint | null, net: bigint | null, vat: bigint | null) {
  if (gross === null || net === null || vat === null) return null;
  return (gross - net - vat).toString();
}

export const assessSource = Effect.fn("expenseTax.assessSource")(function* (
  transaction: Transaction,
  scope: Scope,
  source: JsonObject,
  review: JsonObject | null,
  selection: SnapshotInput,
) {
  yield* requireExpenseAccess(transaction, false);
  const revision = yield* decode(SourceRevisionSchema, source);
  const assessed = review === null ? null : yield* decode(SourceReviewSchema, review);
  const fences = yield* AssessmentDb.readAssessmentFences(
    transaction,
    scope.bookId,
    revision.sourceId,
    revision.evidenceSha256,
    revision.facts.sourceLocator,
    revision.facts.voucherId,
  );
  const fence = fences[0];
  if (fence === undefined) return yield* failure("Forbidden");
  return yield* assess(
    { profile: fence.profile, currency: fence.currency, currencyScale: fence.currencyScale },
    selection,
    revision,
    assessed,
    {
      withdrawn: fence.withdrawn,
      duplicate: fence.duplicate,
      ambiguous: fence.ambiguous,
    },
  );
});

export const prepareSnapshot = Effect.fn("expenseTax.prepareSnapshot")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: SnapshotInput },
) {
  return yield* withExpenseTaxBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "prepare_expense_tax_snapshot",
          principal.actorId,
          payload,
          SnapshotSchema,
        );
        if (request.previous) return request.previous;
        yield* requireExpenseAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(command.input.startsOn) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(command.input.endsOn) ||
          command.input.startsOn > command.input.endsOn
        ) {
          return yield* failure("InvalidJournal");
        }
        const book = (yield* ExpenseDb.readBookState(transaction, command.scope.bookId))[0];
        if (book === undefined) return yield* failure("Forbidden");
        const count = yield* ExpenseDb.readSourceCount(transaction, command.scope.bookId);
        if ((count[0]?.total ?? 0) > sourceBound) return yield* unsupported();
        const rows = yield* ExpenseDb.readCurrentInventory(transaction, command.scope.bookId);
        const entries: Array<JsonObject> = [];
        const totals = {
          grossMinor: 0n,
          netMinor: 0n,
          vatMinor: 0n,
          deductibleMinor: 0n,
          nonDeductibleMinor: 0n,
          expenseMinor: 0n,
        };
        let included = 0;
        let excluded = 0;
        for (const row of rows) {
          const item = row.item;
          const sourceId = item.sourceId;
          if (typeof sourceId !== "string") return yield* failure("InternalError");
          if (
            typeof item.current !== "object" ||
            item.current === null ||
            Array.isArray(item.current)
          ) {
            return yield* failure("InternalError");
          }
          const current = yield* toJsonObject(item.current);
          const source = yield* decode(SourceRevisionSchema, current);
          const review =
            item.latestReview === null || item.latestReview === undefined
              ? null
              : yield* decode(SourceReviewSchema, yield* toJsonObject(item.latestReview));
          const assessment = yield* assess(
            book,
            command.input,
            source,
            review,
            {
              withdrawn: item.withdrawal !== null && item.withdrawal !== undefined,
              duplicate: yield* hasDuplicate(transaction, command.scope.bookId, source),
              ambiguous: yield* hasAmbiguousVoucher(transaction, command.scope.bookId, source),
            },
          );
          if (assessment.state === "included_synthetic") {
            included += 1;
            const contribution = assessment.contribution;
            if (contribution === null) return yield* failure("InternalError");
            totals.grossMinor += BigInt(contribution.grossMinor);
            totals.netMinor += BigInt(contribution.netMinor);
            totals.vatMinor += BigInt(contribution.vatMinor);
            totals.deductibleMinor += BigInt(contribution.deductibleMinor);
            totals.nonDeductibleMinor += BigInt(contribution.nonDeductibleMinor);
            totals.expenseMinor += BigInt(contribution.expenseMinor);
          } else {
            excluded += 1;
          }
          entries.push(
            yield* toJsonObject({
              source,
              review,
              withdrawal: item.withdrawal ?? null,
              assessment,
            }),
          );
        }
        const ceiling = (
          yield* ExpenseDb.readSnapshotCeiling(transaction, command.scope.bookId)
        )[0]?.ordinal;
        if (ceiling === undefined) return yield* failure("InternalError");
        const ordinal = BigInt(ceiling) + 1n;
        if (ordinal > 999999999999999999n) return yield* unsupported();
        const body = yield* digestBody(transaction, {
          schemaVersion: "2",
          calculationEngine: "expense-tax-controls-v2",
          bookProfile: book.profile,
          bookProfileVersion: book.profileVersion,
          id: newId("taxsnapshot"),
          scope: command.scope,
          input: command.input,
          basisDigest: yield* readBasis(transaction, command.scope.bookId),
          bookSequence: book.committedSequence,
          currency: book.currency,
          currencyScale: book.currencyScale,
          entries,
          includedCount: included,
          excludedCount: excluded,
          syntheticTotals: {
            grossMinor: totals.grossMinor.toString(),
            netMinor: totals.netMinor.toString(),
            vatMinor: totals.vatMinor.toString(),
            deductibleMinor: totals.deductibleMinor.toString(),
            nonDeductibleMinor: totals.nonDeductibleMinor.toString(),
            expenseMinor: totals.expenseMinor.toString(),
          },
          coverageEstablished: false,
          ledgerReconciled: false,
          vatReturnReady: false,
          productionProfileApproved: false,
          postingEnabled: false,
          recordedAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "prepare_expense_tax_snapshot",
            actorId: principal.actorId,
          },
        });
        const snapshot = yield* decode(SnapshotSchema, body);
        yield* ExpenseDb.insertSnapshot(transaction, {
          bookId: command.scope.bookId,
          id: snapshot.id,
          ordinal: ordinal.toString(),
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "prepare_expense_tax_snapshot",
          principal.actorId,
          snapshot,
        );
        return snapshot;
      }),
    "update",
  );
});

function hasDuplicate(transaction: Transaction, bookId: string, source: SourceRevision) {
  return ExpenseDb.readCompetingSources(
    transaction,
    bookId,
    source.sourceId,
    source.evidenceSha256,
    source.facts.sourceLocator,
  ).pipe(
    Effect.map((rows) => {
      const found = rows[0]?.sourceId;
      return found !== undefined && found !== null;
    }),
  );
}

function hasAmbiguousVoucher(transaction: Transaction, bookId: string, source: SourceRevision) {
  if (source.facts.voucherId === null) return Effect.succeed(false);
  return ExpenseDb.readCompetingVoucherSources(
    transaction,
    bookId,
    source.sourceId,
    source.facts.voucherId,
  ).pipe(Effect.map((rows) => (rows[0]?.sourceId ?? null) !== null));
}

export const getSnapshot = Effect.fn("expenseTax.getSnapshot")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withExpenseTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireExpenseAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* ExpenseDb.readSnapshot(transaction, command.scope.bookId, command.id))[0];
      if (row === undefined) return yield* failure("NotFound");
      const snapshot = yield* decode(SnapshotSchema, row.body);
      return yield* decode(SnapshotViewSchema, {
        snapshot,
        basisCurrent: snapshot.basisDigest === (yield* readBasis(transaction, command.scope.bookId)),
      });
    }),
  );
});

export const listSnapshots = Effect.fn("expenseTax.listSnapshots")(function* (
  token: string,
  command: { scope: Scope; after?: string; sourceId?: string },
) {
  return yield* withExpenseTaxBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireExpenseAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const ceiling = (
        yield* ExpenseDb.readSnapshotCeiling(transaction, command.scope.bookId)
      )[0]?.ordinal;
      if (ceiling === undefined) return yield* failure("InternalError");
      if (command.sourceId === undefined) {
        return yield* decode(SnapshotPageSchema, {
          items: yield* readUnfilteredPage(
            transaction,
            command.scope,
            command.after ?? "",
            ceiling,
          ),
          next: yield* unfilteredCursor(transaction, command.scope, command.after ?? "", ceiling),
        });
      }
      return yield* readMembershipPage(
        transaction,
        command.scope,
        command.sourceId,
        command.after,
        ceiling,
      );
    }),
  );
});

function unfilteredPrefix(transaction: Transaction, scope: Scope) {
  return digestValue(transaction, scope).pipe(Effect.map((digest) => digest.slice(8, 24)));
}

function readUnfilteredPage(
  transaction: Transaction,
  scope: Scope,
  after: string,
  observedCeiling: string,
) {
  return Effect.gen(function* () {
    const prefix = yield* unfilteredPrefix(transaction, scope);
    let ceiling = observedCeiling;
    let last = "0";
    if (after !== "") {
      const parts = after.split("_");
      if (parts.length !== 3 || !/^[0-9]{1,18}$/.test(parts[1] ?? "") || !/^[0-9]{1,18}$/.test(parts[2] ?? "")) {
        return yield* failure("InvalidJournal");
      }
      if (parts[0] !== prefix) return yield* failure("InvalidJournal");
      ceiling = parts[1] ?? "0";
      last = parts[2] ?? "0";
      if (BigInt(last) > BigInt(ceiling)) return yield* failure("InvalidJournal");
    }
    if (BigInt(ceiling) > BigInt(observedCeiling)) return yield* failure("InvalidJournal");
    const rows = yield* ExpenseDb.readSnapshotWindow(
      transaction,
      scope.bookId,
      last,
      ceiling,
      snapshotPageBound,
    );
    const items: Array<JsonObject> = [];
    for (const row of rows) {
      const body = row.body;
      const summary = yield* toJsonObject(body);
      items.push(
        yield* toJsonObject({
          id: summary.id ?? null,
          digest: summary.digest ?? null,
          input: summary.input ?? null,
          recordedAt: summary.recordedAt ?? null,
        }),
      );
    }
    return { items, last: rows.at(-1)?.ordinal ?? last, prefix };
  });
}

function unfilteredCursor(
  transaction: Transaction,
  scope: Scope,
  after: string,
  observedCeiling: string,
) {
  return readUnfilteredPage(transaction, scope, after, observedCeiling).pipe(
    Effect.map((page) => {
      const ceiling = after === "" ? observedCeiling : (after.split("_")[1] ?? observedCeiling);
      return BigInt(page.last) >= BigInt(ceiling)
        ? null
        : `${page.prefix}_${ceiling}_${page.last}`;
    }),
  );
}

type MembershipWindow = {
  readonly ceiling: string;
  readonly last: string;
  readonly anchor: string | null;
};

function readMembershipWindow(
  after: string | undefined,
  observedCeiling: string,
): MembershipWindow {
  if (after === undefined || after === "") {
    return { ceiling: observedCeiling, last: "0", anchor: null };
  }
  const parts = after.split("_");
  if (
    parts.length !== 4 ||
    parts[0] !== "esm1" ||
    !/^[0-9]{1,18}$/.test(parts[2] ?? "") ||
    !/^[0-9]{1,18}$/.test(parts[3] ?? "")
  ) {
    return { ceiling: observedCeiling, last: "0", anchor: "invalid" };
  }
  return { ceiling: parts[2] ?? "0", last: parts[3] ?? "0", anchor: parts[1] ?? null };
}

function requireObservedOrdinal(transaction: Transaction, bookId: string, ordinal: string) {
  if (BigInt(ordinal) <= 0n) return Effect.void;
  return ExpenseDb.readSnapshotExistsAtOrdinal(transaction, bookId, ordinal).pipe(
    Effect.flatMap((rows) => (rows[0]?.found === true ? Effect.void : failure("InvalidJournal"))),
  );
}

function readMembershipItem(
  row: ExpenseDb.SnapshotRow,
  sourceId: string,
) {
  return Effect.gen(function* () {
    const snapshot = yield* decode(SnapshotSchema, row.body);
    if (snapshot.entries.length > snapshotMembershipBound) return yield* unsupported();
    const matches = snapshot.entries.filter((entry) => entry.source.sourceId === sourceId);
    if (matches.length > 1) return yield* unsupported();
    const entry = matches[0];
    if (entry === undefined) return null;
    const capturedWithdrawal = entry.withdrawal ?? null;
    if (
      (entry.review !== null && entry.review.sourceId !== sourceId) ||
      (capturedWithdrawal !== null &&
        (capturedWithdrawal.sourceId !== sourceId ||
          capturedWithdrawal.revisionDigest !== entry.source.digest))
    ) {
      return yield* unsupported();
    }
    return yield* toJsonObject({
      id: snapshot.id,
      digest: snapshot.digest,
      input: snapshot.input,
      recordedAt: snapshot.recordedAt,
      sourceMembership: {
        schemaVersion: snapshot.schemaVersion,
        calculationEngine: snapshot.calculationEngine,
        revisionId: entry.source.id,
        revision: entry.source.revision,
        sourceDigest: entry.source.digest,
        review:
          entry.review === null
            ? null
            : {
                id: entry.review.id,
                revision: entry.review.revision,
                digest: entry.review.digest,
                sourceDigest: entry.review.sourceDigest,
              },
        withdrawal: capturedWithdrawal,
        assessment: entry.assessment,
      },
    });
  });
}

function membershipPrefix(
  transaction: Transaction,
  scope: Scope,
  sourceId: string,
  ceiling: string,
) {
  return digestValue(transaction, {
    scope,
    sourceId,
    ceiling,
    interpretation: "expense-source-membership-v1",
  }).pipe(Effect.map((digest) => digest.slice(8)));
}

function readMembershipPage(
  transaction: Transaction,
  scope: Scope,
  sourceId: string,
  after: string | undefined,
  observedCeiling: string,
) {
  return Effect.gen(function* () {
    if (
      (yield* ExpenseDb.readSourceById(transaction, scope.bookId, sourceId))[0] === undefined
    ) {
      return yield* failure("NotFound");
    }
    const window = readMembershipWindow(after, observedCeiling);
    const ceiling = window.ceiling;
    const last = window.last;
    const prefix = yield* membershipPrefix(transaction, scope, sourceId, ceiling);
    if (window.anchor !== null && window.anchor !== prefix) return yield* failure("InvalidJournal");
    if (window.anchor === "invalid") return yield* failure("InvalidJournal");
    if (BigInt(last) > BigInt(ceiling)) return yield* failure("InvalidJournal");
    if (BigInt(ceiling) > BigInt(observedCeiling)) return yield* failure("InvalidJournal");
    yield* requireObservedOrdinal(transaction, scope.bookId, ceiling);
    yield* requireObservedOrdinal(transaction, scope.bookId, last);
    const rows = yield* ExpenseDb.readSnapshotWindow(
      transaction,
      scope.bookId,
      last,
      ceiling,
      snapshotPageBound,
    );
    const items: Array<JsonObject> = [];
    let through = last;
    let examined = 0;
    for (const row of rows) {
      examined += 1;
      through = row.ordinal;
      const item = yield* readMembershipItem(row, sourceId);
      if (item !== null) items.push(item);
    }
    const remaining = (
      yield* ExpenseDb.readSnapshotWindow(
        transaction,
        scope.bookId,
        through,
        ceiling,
        1,
      )
    ).length;
    return yield* decode(SnapshotPageSchema, {
      membershipScan: {
        sourceId,
        cutoffOrdinal: ceiling,
        examinedThroughOrdinal: through,
        examinedCount: examined,
        interpretation: "retained_source_membership",
        currentnessChecked: false,
        legalObligationAssessed: false,
      },
      items,
      next: remaining > 0 ? `esm1_${prefix}_${ceiling}_${through}` : null,
    });
  });
}

export type { Assessment, SourceReview, SourceRevision };
