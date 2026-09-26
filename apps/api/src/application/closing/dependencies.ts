import { digest as digestNative } from "../json";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as Db from "../../db/closing/dependencies";
import type { Transaction } from "../../db/transaction";
import { readBasis as readVatBasis } from "../vat/basis";
import { failure } from "../failures";
import { unsupported } from "../commerce/support";

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

const subledgerScheduleBound = 200;

const subledgerAccountBound = 1000;

const subledgerPeriodBound = 1000;

const subledgerPreparationBound = 10000;

const subledgerImpairmentReviewBound = 4000;

const subledgerImpairmentBound = 4000;

const taxAccountStatementBound = 200;

const taxAccountControlBound = 200;

const taxAccountMatchBound = 1000;

const taxAccountUnmatchBound = 1000;

const taxAccountClassificationBound = 1000;

const vatFactBound = 200;

const vatDraftBound = 500;

const vatAmendmentBound = 500;

const vatProfileBound = 20;

const vatObligationBound = 200;

const vatReviewBound = 500;

const vatApprovalBound = 10000;

const vatEffectBound = 500;

const vatContributionBound = 5000;

const subledgerLimitation =
  "Schedule inventory completeness, impairment valuation policy and control reconciliation are not established.";

function requireDependencyAccess(transaction: Transaction) {
  return Db.readDependencyAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = Db.closingDependencyTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);

        return access === undefined || !access.canSelect;
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonObject(entries: ReadonlyArray<readonly [string, Json | undefined]>): JsonObject {
  const result: Record<string, Json> = {};

  for (const [key, value] of entries) {
    if (value !== undefined) result[key] = value;
  }

  return result;
}

function textField(value: JsonObject, key: string) {
  const found = value[key];

  return typeof found === "string" ? found : null;
}

function optionalTextField(value: JsonObject | null, key: string) {
  return value === null ? undefined : (textField(value, key) ?? undefined);
}

export const bankCloseDependencies = Effect.fn("closing.dependencies.bankClose")(function* (
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  yield* requireDependencyAccess(transaction);
  const sources = yield* Db.readBankCloseSources(transaction, bookId, startsOn, endsOn);

  const allRepresentedReady =
    sources.length > 0 && sources.every((row) => row.reconciliationId !== null);

  return {
    sources: sources.map((row) => ({
      accountId: row.accountId,
      sourceId: row.sourceId,
      revision: row.revision,
      reconciliationId: row.reconciliationId,
      reconciliationKind: row.reconciliationKind,
      reconciliationCreatedAt: row.reconciliationCreatedAt,
    })),
    allRepresentedReady,
  } satisfies JsonObject;
});

export const commercePeriodStatus = Effect.fn("closing.dependencies.commercePeriodStatus")(
  function* (transaction: Transaction, bookId: string, startsOn: string, endsOn: string) {
    yield* requireDependencyAccess(transaction);

    if (startsOn > endsOn) return yield* failure("InvalidJournal");
    const book = (yield* Db.readCommerceBook(transaction, bookId))[0];

    if (!book) return yield* failure("NotFound");
    const invoices = yield* Db.readCommerceInvoices(transaction, bookId, endsOn);
    const legs = yield* Db.readCommerceLegs(transaction, bookId, endsOn);

    const allocationFailures = yield* Db.countCommerceAllocationCapacityFailures(
      transaction,
      bookId,
      endsOn,
    );

    const creditFailures = yield* Db.countCommerceCreditCapacityFailures(
      transaction,
      bookId,
      endsOn,
    );

    const reversals = yield* Db.readCommerceReversals(transaction, bookId, endsOn);
    const cancellations = yield* Db.readCommerceCancellations(transaction, bookId, endsOn);
    const credits = yield* Db.readCommerceSupplierCredits(transaction, bookId, endsOn);
    const invalidRecognition = invoices.filter((row) => row.invalid).length;
    const invalidAllocation = legs.filter((row) => row.invalid).length;
    const invalidCredit = credits.filter((row) => row.invalid).length;
    const conservation = (allocationFailures[0]?.total ?? 0) + (creditFailures[0]?.total ?? 0);
    const sources: Json = invoices.map((row) => row.body);

    const allocations: Json = legs.map((row) => ({
      receiptId: row.receiptId,
      ordinal: row.ordinal,
      invoiceId: row.invoiceId,
      voucherId: row.voucherId,
      lineId: row.lineId,
      postingDate: row.postingDate,
      amountMinor: row.amountMinor,
      planDigest: row.planDigest,
    }));

    const unallocations: Json = reversals.map((row) => row.body);
    const invoiceCancellations: Json = cancellations.map((row) => row.body);
    const supplierCredits: Json = credits.map((row) => row.body);

    const sourceDigest = yield* digestNative(
      jsonObject([
        ["scope", { bookId, entityId: book.entityId }],
        ["currency", book.currency],
        ["currencyScale", book.currencyScale],
        ["startsOn", startsOn],
        ["endsOn", endsOn],
        ["invoices", sources],
        ["allocations", allocations],
        ["unallocations", unallocations.length === 0 ? undefined : unallocations],
        [
          "invoiceCancellations",
          invoiceCancellations.length === 0 ? undefined : invoiceCancellations,
        ],
        ["supplierCredits", supplierCredits.length === 0 ? undefined : supplierCredits],
      ]),
    );

    const blockers: Json[] = [];

    if (invalidCredit > 0) {
      blockers.push("Supplier credit control effects are invalid or reversed.");
    }

    if (invalidRecognition > 0) {
      blockers.push("Registered invoice recognition is invalid or reversed.");
    }

    if (invalidAllocation > 0) {
      blockers.push("Registered payment allocations have invalid or reversed references.");
    }

    if (conservation > 0) {
      blockers.push("Registered allocation capacities are inconsistent.");
    }

    return {
      schemaVersion: 1,
      coverage: "not_established",
      startsOn,
      endsOn,
      registeredInvoiceCount: invoices.length,
      invalidRecognitionCount: invalidRecognition,
      invalidAllocationCount: invalidAllocation,
      conservationFailureCount: conservation,
      sourceDigest,
      blockers,
    } satisfies JsonObject;
  },
);

export const expenseTaxDependencies = Effect.fn("closing.dependencies.expenseTax")(function* (
  transaction: Transaction,
  bookId: string,
) {
  yield* requireDependencyAccess(transaction);
  const book = (yield* Db.readExpenseTaxBook(transaction, bookId))[0];
  const basisSources = yield* Db.readExpenseTaxBasisSources(transaction, bookId);
  const sources = yield* Db.readExpenseTaxDependencySources(transaction, bookId);
  let withdrawnSourceCount = 0;
  let missingOrStaleReviewCount = 0;

  for (const source of sources) {
    if (source.withdrawn) {
      withdrawnSourceCount += 1;
      continue;
    }

    if (source.currentBody === null) return yield* failure("NotFound");
    const currentDigest = textField(source.currentBody, "digest");
    const reviewDigest = textField(source.reviewBody ?? {}, "sourceDigest");

    if (reviewDigest !== currentDigest) missingOrStaleReviewCount += 1;
  }

  const basisDigest =
    book === undefined
      ? null
      : yield* digestNative({
          bookId,
          currency: book.currency,
          currencyScale: book.currencyScale,
          profile: book.profile,
          profileVersion: book.profileVersion,
          sources: basisSources.map((row) => ({
            id: row.id,
            sourceDigest: row.sourceDigest,
            reviewDigest: row.reviewDigest,
            withdrawalDigest: row.withdrawalDigest,
          })),
        });

  return {
    basisDigest,
    sourceCount: sources.length,
    withdrawnSourceCount,
    missingOrStaleReviewCount,
    coverageEstablished: false,
    productionProfileApproved: false,
    vatReturnReady: false,
    postingEnabled: false,
  } satisfies JsonObject;
});

export const ownerPeriodStatus = Effect.fn("closing.dependencies.ownerPeriodStatus")(function* (
  transaction: Transaction,
  bookId: string,
  startsOn: string,
  endsOn: string,
) {
  yield* requireDependencyAccess(transaction);
  const records = yield* Db.readOwnerPeriodSources(transaction, bookId, endsOn);
  const effects = yield* Db.readOwnerPeriodEffects(transaction, bookId, endsOn);
  const legs = yield* Db.readOwnerPeriodLegs(transaction, bookId, endsOn);

  const sources: Json = records.map((row) => ({
    source: row.source,
    revision: row.revision,
    review: row.review,
  }));

  const unresolvedReviewCount = records.filter(
    (row) =>
      row.reviewId === null ||
      textField(row.revision, "classification") === "unknown" ||
      textField(row.revision, "origin") === "unknown",
  ).length;

  const unlinkedRecordCount = records.filter((row) => !row.linked).length;

  const sourceDigest = yield* digestNative({
    sources,
    effects: effects.map((row) => row.body),
    allocations: legs.map((row) => row.leg),
  });

  const blockers: Json[] =
    unresolvedReviewCount + unlinkedRecordCount > 0
      ? ["Owner sources have unresolved review or posted-reference coverage."]
      : [];

  return {
    schemaVersion: 1,
    coverage: "not_established",
    startsOn,
    endsOn,
    registeredRecordCount: records.length,
    unresolvedReviewCount,
    unlinkedRecordCount,
    sourceDigest,
    blockers,
  } satisfies JsonObject;
});

export const subledgerCloseDependencies = Effect.fn("closing.dependencies.subledgerClose")(
  function* (transaction: Transaction, bookId: string, endsOn: string) {
    yield* requireDependencyAccess(transaction);
    const schedules = yield* Db.readSubledgerScheduleRevisions(transaction, bookId, endsOn);

    const states = yield* Db.readSubledgerOccurrenceStates(
      transaction,
      bookId,
      endsOn,
      schedules.map((row) => ({ id: row.id, body: row.body })),
    );

    const impairments = yield* Db.readSubledgerImpairmentDigests(transaction, bookId, endsOn);
    const impairmentCount = yield* Db.countSubledgerImpairments(transaction, bookId, endsOn);
    const stateBySchedule = new Map(states.map((row) => [row.scheduleId, row.states] as const));

    const impairmentBySchedule = new Map(
      impairments.map((row) => [row.scheduleId, row.digests] as const),
    );

    let dueUnpreparedCount = 0;
    let dueUnpostedCount = 0;
    let reversedOccurrenceCount = 0;
    let conflictedOccurrenceCount = 0;
    const scheduleEntries: Json[] = [];

    for (const schedule of schedules) {
      const retainedStates = stateBySchedule.get(schedule.id);
      const scheduleStates: Json[] = Array.isArray(retainedStates) ? [...retainedStates] : [];
      const disposalDate = optionalTextField(schedule.disposal, "postingDate");

      for (const occurrence of scheduleStates.filter(isJsonObject)) {
        const state = textField(occurrence, "state");

        const notPreparedOrUnprepared =
          state !== null && state !== "unprepared" && state !== "prepared";

        const occurrenceDate = textField(occurrence, "postingDate");

        const represented =
          schedule.disposal === null ||
          (disposalDate !== undefined && disposalDate > endsOn) ||
          notPreparedOrUnprepared ||
          (disposalDate !== undefined && occurrenceDate !== null && occurrenceDate < disposalDate);

        if (!represented) continue;

        if (state === "unprepared") dueUnpreparedCount += 1;

        if (state === "unprepared" || state === "prepared" || state === "conflicted") {
          dueUnpostedCount += 1;
        }

        if (state === "reversed") reversedOccurrenceCount += 1;

        if (state === "conflicted") conflictedOccurrenceCount += 1;
      }

      scheduleEntries.push(
        jsonObject([
          ["id", schedule.id],
          ["digest", textField(schedule.body, "digest")],
          ["occurrences", scheduleStates],
          ["impairmentDigests", impairmentBySchedule.get(schedule.id) ?? []],
          ["disposalDigest", optionalTextField(schedule.disposal, "digest")],
        ]),
      );
    }

    return {
      coverageEstablished: false,
      scheduleRevisionDigest: yield* digestNative(scheduleEntries),
      scheduleCount: schedules.length,
      dueUnpreparedCount,
      dueUnpostedCount,
      reversedOccurrenceCount,
      conflictedOccurrenceCount,
      impairmentCount: impairmentCount[0]?.total ?? 0,
      limitation: subledgerLimitation,
    } satisfies JsonObject;
  },
);

export const subledgerControlDependencies = Effect.fn("closing.dependencies.subledgerControl")(
  function* (transaction: Transaction, bookId: string) {
    yield* requireDependencyAccess(transaction);
    const book = (yield* Db.readSubledgerControlBook(transaction, bookId))[0];
    const periods = yield* Db.readSubledgerControlPeriods(transaction, bookId);
    const accounts = yield* Db.readSubledgerControlAccounts(transaction, bookId);
    const schedules = yield* Db.readSubledgerControlScheduleDigests(transaction, bookId);
    const bases = yield* Db.readSubledgerControlBasisDigests(transaction, bookId);
    const preparations = yield* Db.readSubledgerControlPreparations(transaction, bookId);
    const disposals = yield* Db.readSubledgerControlDisposalDigests(transaction, bookId);
    const impairments = yield* Db.readSubledgerControlImpairmentDigests(transaction, bookId);
    const reviews = yield* Db.countSubledgerControlImpairmentReviews(transaction, bookId);

    if (
      book === undefined ||
      periods.length > subledgerPeriodBound ||
      accounts.length > subledgerAccountBound ||
      schedules.length > subledgerScheduleBound ||
      preparations.length > subledgerPreparationBound ||
      (reviews[0]?.total ?? 0) > subledgerImpairmentReviewBound ||
      impairments.length > subledgerImpairmentBound
    ) {
      return yield* unsupported();
    }

    if (schedules.some((row) => row.digest === null)) return yield* failure("NotFound");

    const basisDigest = yield* digestNative(
      jsonObject([
        ["sequence", book.committedSequence],
        ["profile", book.profile],
        ["profileVersion", book.profileVersion],
        ["authority", book.authority],
        ["writerEpoch", book.writerEpoch],
        ["currency", book.currency],
        ["currencyScale", book.currencyScale],
        [
          "periods",
          periods.map((row) => ({
            id: row.id,
            version: row.version,
            locked: row.locked,
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            year: row.fiscalYearId,
          })),
        ],
        [
          "accounts",
          accounts.map((row) => ({
            id: row.id,
            version: row.version,
            code: row.code,
            name: row.name,
            active: row.active,
          })),
        ],
        ["schedules", schedules.map((row) => row.digest)],
        ["bases", bases.map((row) => row.digest)],
        ["preparations", preparations.map((row) => row.preparation)],
        ["disposals", disposals.length === 0 ? undefined : disposals.map((row) => row.digest)],
        [
          "impairments",
          impairments.length === 0 ? undefined : impairments.map((row) => row.digest),
        ],
      ]),
    );

    const coverage = yield* Db.readSubledgerControlCoverage(transaction, bookId);

    return {
      version: "synthetic_subledger_controls_v1",
      basisDigest,
      basisCount: bases.length,
      snapshotCount: coverage[0]?.snapshotCount ?? 0,
      missingBasisCount: coverage[0]?.missingBasisCount ?? 0,
      coverageEstablished: false,
      controlAccountReconciled: false,
      financialCloseReady: false,
    } satisfies JsonObject;
  },
);

function taxAccountCloseDependencies(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const bounds = (yield* Db.readTaxAccountBounds(transaction, bookId))[0];

    if (!bounds) return yield* failure("InternalError");

    if (
      bounds.statementCount > taxAccountStatementBound ||
      bounds.controlCount > taxAccountControlBound ||
      bounds.matchCount > taxAccountMatchBound ||
      bounds.unmatchCount > taxAccountUnmatchBound ||
      bounds.classificationCount > taxAccountClassificationBound
    ) {
      return null;
    }

    const statements = yield* Db.readTaxAccountStatements(transaction, bookId);
    const controls = yield* Db.readTaxAccountControls(transaction, bookId);
    const matches = yield* Db.readTaxAccountMatches(transaction, bookId);
    const unmatches = yield* Db.readTaxAccountUnmatches(transaction, bookId);
    const active = yield* Db.readTaxAccountActiveState(transaction, bookId);
    const classifications = yield* Db.readTaxAccountClassifications(transaction, bookId);

    const matching: JsonObject = {
      matchCount: bounds.matchCount,
      unmatchCount: bounds.unmatchCount,
      matchInventoryDigest: yield* digestNative(
        matches.map((row) => ({ id: row.id, digest: row.digest })),
      ),
      unmatchInventoryDigest: yield* digestNative(
        unmatches.map((row) => ({ id: row.id, matchId: row.matchId, digest: row.digest })),
      ),
      activeStateDigest: yield* digestNative(
        active.map((row) => ({
          id: row.id,
          active: row.active,
          usable: row.usable,
          corrections: row.corrections,
        })),
      ),
    };

    return jsonObject([
      ["matching", matching],
      ["statementCount", bounds.statementCount],
      ["controlCount", bounds.controlCount],
      [
        "statementInventoryDigest",
        yield* digestNative(statements.map((row) => ({ id: row.id, digest: row.digest }))),
      ],
      [
        "controlInventoryDigest",
        yield* digestNative(
          controls.map((row) => ({
            id: row.id,
            digest: row.digest,
            sha256: row.sha256,
            byteLength: row.byteLength,
          })),
        ),
      ],
      [
        "classificationResolutionCount",
        classifications.length === 0 ? undefined : classifications.length,
      ],
      [
        "classificationResolutionDigest",
        classifications.length === 0
          ? undefined
          : yield* digestNative(classifications.map((row) => ({ id: row.id, digest: row.digest }))),
      ],
    ]);
  });
}

export const vatReturnDependencies = Effect.fn("closing.dependencies.vatReturn")(function* (
  transaction: Transaction,
  bookId: string,
) {
  yield* requireDependencyAccess(transaction);
  const bounds = (yield* Db.readVatReturnBounds(transaction, bookId))[0];

  if (!bounds) return yield* failure("InternalError");

  if (
    bounds.factCount > vatFactBound ||
    bounds.draftCount > vatDraftBound ||
    bounds.amendmentCount > vatAmendmentBound ||
    bounds.profileCount > vatProfileBound ||
    bounds.obligationCount > vatObligationBound ||
    bounds.reviewCount > vatReviewBound ||
    bounds.approvalCount > vatApprovalBound ||
    bounds.effectCount > vatEffectBound ||
    bounds.contributionCount > vatContributionBound
  ) {
    return null;
  }

  const parents = (yield* Db.readVatReturnParentBounds(transaction, bookId))[0];

  if (parents?.exceeded === true) return null;
  const taxAccounts = yield* taxAccountCloseDependencies(transaction, bookId);

  if (taxAccounts === null) return null;
  const basis = yield* readVatBasis(transaction, bookId);
  const inventories = (yield* Db.readVatReturnInventories(transaction, bookId))[0];

  if (!inventories) return yield* failure("InternalError");

  return {
    basisDigest: basis.digest,
    sourceCount: basis.facts.length,
    draftCount: bounds.draftCount,
    taxAccounts,
    profileCount: bounds.profileCount,
    profileInventoryDigest: yield* digestNative(inventories.profiles),
    obligationCount: bounds.obligationCount,
    obligationInventoryDigest: yield* digestNative(inventories.obligations),
    reviewCount: bounds.reviewCount,
    reviewInventoryDigest: yield* digestNative(inventories.reviews),
    approvalCount: bounds.approvalCount,
    approvalInventoryDigest: yield* digestNative(inventories.approvals),
    effectCount: bounds.effectCount,
    effectInventoryDigest: yield* digestNative(inventories.effects),
    contributionCount: bounds.contributionCount,
    contributionInventoryDigest: yield* digestNative(inventories.contributions),
    amendmentCount: bounds.amendmentCount,
    amendmentInventoryDigest: yield* digestNative(inventories.amendments),
    coverageEstablished: false,
    ledgerReconciled: false,
    legalProfileActive: false,
    filingReady: false,
  } satisfies JsonObject;
});
