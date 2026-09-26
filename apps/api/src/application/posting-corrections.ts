import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "./failures";
import { withAdmittedPrincipal, type VerifiedPrincipal } from "./identity";
import {
  digest,
  executeChangeInTransaction,
  isoNow,
  newId,
  readBook,
  readPeriod,
  readVoucher,
  replay,
  saveCommand,
  validateAction,
  validatePlan,
} from "./posting";
import * as Db from "../db/posting";
import * as CorrectionDb from "../db/posting-corrections";
import { databaseFailure, type Transaction } from "../db/transaction";

type Scope = typeof Accounting.Scope.Type;
type Principal = VerifiedPrincipal;
type Action = typeof Accounting.VoucherPostingAction.Type;
type Intent = typeof Corrections.CorrectionIntent.Type;
type Impact = typeof Corrections.CorrectionImpact.Type;
type ImpactBasis = typeof Corrections.CorrectionImpactBasis.Type;
type Blocker = typeof Corrections.CorrectionBlocker.Type;
type JsonObject = Schema.JsonObject;

const BundleApproval = Corrections.CorrectionBundleApproval;
const BundleReceipt = Corrections.CorrectionBundleReceipt;

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function withBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown>,
  lockMode: "share" | "update" = "share",
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

function bundleFromRow(row: { body: JsonObject }) {
  return decode(Corrections.CorrectionBundle, row.body);
}

function assertBundleDigest(bundle: typeof Corrections.CorrectionBundle.Type) {
  return Effect.gen(function* () {
    const withoutDigest = Object.fromEntries(
      Object.entries(bundle).filter(([key]) => key !== "bundleDigest"),
    );
    const current = yield* digest(withoutDigest, "StaleDependency");
    if (current !== bundle.bundleDigest) return yield* failure("StaleDependency");
  });
}

function validateBundle(bundle: typeof Corrections.CorrectionBundle.Type) {
  return Effect.gen(function* () {
    yield* assertBundleDigest(bundle);
    if (bundle.reversal.id === bundle.replacement.id) return yield* failure("StaleDependency");
  });
}

function makePlan(transaction: Transaction, scope: Scope, principal: Principal, action: Action) {
  return Effect.gen(function* () {
    const book = yield* readBook(transaction, scope);
    const period = yield* readPeriod(transaction, scope, action.accountingPeriodId);
    const accountRows = yield* Db.readAccounts(
      transaction,
      scope.bookId,
      action.lines.map((line) => line.accountId),
    );
    const createdAt = yield* isoNow(transaction);
    const withoutDigest = {
      schemaVersion: "1" as const,
      canonicalization: "openerp-c14n-v1" as const,
      id: newId("change"),
      version: 1 as const,
      scope,
      createdAt,
      dependencies: [
        {
          kind: "profile" as const,
          resourceId: book.id,
          version: book.profileVersion.toString(),
          reason: "Book currency and supported profile",
        },
        {
          kind: "writer_epoch" as const,
          resourceId: book.id,
          version: book.writerEpoch.toString(),
          reason: "Single authoritative writer",
        },
        {
          kind: "period" as const,
          resourceId: period.id,
          version: period.version.toString(),
          reason: "Posting dates and lock state",
        },
        ...accountRows.map((account) => ({
          kind: "account" as const,
          resourceId: account.id,
          version: account.version.toString(),
          reason: "Exact account configuration",
        })),
      ],
      groups: [
        {
          id: newId("group"),
          dependsOnGroupIds: [],
          actions: [action],
        },
      ],
    };
    const planDigest = yield* digest(withoutDigest);
    const plan = yield* decode(Accounting.ChangeSet, { ...withoutDigest, planDigest });
    yield* Db.insertPlan(transaction, {
      bookId: scope.bookId,
      id: plan.id,
      plan,
      digest: planDigest,
      createdBy: principal.actorId,
    });
    return plan;
  });
}

function correctionChain(transaction: Transaction, scope: Scope, voucherId: string) {
  return Effect.gen(function* () {
    const idRows = yield* CorrectionDb.readChainVoucherIds(transaction, scope.bookId, voucherId);
    if (idRows.length === 0) return yield* failure("NotFound");
    if (idRows.length > 200) return yield* failure("UnsupportedProfile");
    const ids = idRows.map((row) => row.id);
    const voucherRows = yield* CorrectionDb.readVouchersByIds(transaction, scope.bookId, ids);
    if (voucherRows.length === 0) return yield* failure("NotFound");
    const retainedVouchers = yield* Effect.forEach(voucherRows, (row) =>
      decode(Accounting.Voucher, {
        id: row.id,
        number: row.number.toString(),
        sequence: row.sequence.toString(),
        recordedAt: row.recordedAt,
        action: row.action,
      }),
    );
    const lineRows = yield* CorrectionDb.readChainLines(transaction, scope.bookId, ids);
    const totals = new Map<string, { debit: bigint; credit: bigint }>();
    for (const line of lineRows) {
      const current = totals.get(line.accountId) ?? { debit: 0n, credit: 0n };
      current.debit += BigInt(line.debitMinor);
      current.credit += BigInt(line.creditMinor);
      totals.set(line.accountId, current);
    }
    const receiptRows = yield* CorrectionDb.readBundleReceiptsForVouchers(
      transaction,
      scope.bookId,
      ids,
    );
    const receipts = yield* Effect.forEach(receiptRows, (row) => decode(BundleReceipt, row.body));
    receipts.sort((left, right) => left.committedAt.localeCompare(right.committedAt));
    const book = yield* readBook(transaction, scope);
    return {
      scope,
      selectedVoucherId: voucherId,
      rootVoucherId: retainedVouchers[0]?.id ?? voucherId,
      sequence: book.committedSequence.toString(),
      vouchers: retainedVouchers,
      receipts,
      balances: Array.from(totals, ([accountId, total]) => {
        const balance = total.debit - total.credit;
        return {
          accountId,
          debitMinor: total.debit.toString(),
          creditMinor: total.credit.toString(),
          balanceMinor: balance.toString(),
        };
      }),
    } satisfies typeof Corrections.CorrectionChain.Type;
  });
}

function netChange(transaction: Transaction, scope: Scope, voucherId: string, input: Intent) {
  return Effect.gen(function* () {
    const original = yield* readVoucher(transaction, scope, voucherId);
    const deltas = new Map<string, bigint>();
    for (const line of original.action.lines) {
      deltas.set(
        line.accountId,
        (deltas.get(line.accountId) ?? 0n) - BigInt(line.debitMinor) + BigInt(line.creditMinor),
      );
    }
    for (const line of input.replacement.lines) {
      deltas.set(
        line.accountId,
        (deltas.get(line.accountId) ?? 0n) + BigInt(line.debitMinor) - BigInt(line.creditMinor),
      );
    }
    return Array.from(deltas, ([accountId, delta]) => ({ accountId, deltaMinor: delta.toString() }))
      .filter((row) => row.deltaMinor !== "0")
      .sort((left, right) => left.accountId.localeCompare(right.accountId));
  });
}

function impactBasis(transaction: Transaction, scope: Scope, voucherId: string, input: Intent) {
  return Effect.gen(function* () {
    const original = yield* readVoucher(transaction, scope, voucherId);
    const chain = yield* correctionChain(transaction, scope, voucherId);
    const resourceRows = yield* CorrectionDb.readImpactResources(
      transaction,
      scope.bookId,
      voucherId,
      input.postingDate,
    );
    if (resourceRows.length > 1000) return yield* failure("UnsupportedProfile");
    const resources = yield* Effect.forEach(resourceRows, (row) =>
      decode(Corrections.CorrectionImpactResource, row.resource),
    );
    const blockers: Array<Blocker> = resources
      .filter((resource) => resource.blocks)
      .map((resource) => ({ code: "UnsupportedProfile", message: resource.detail }));
    if (original.action.postingPurpose === "reversal") {
      blockers.push({
        code: "InvalidJournal",
        message: "Correct the original or its replacement, not a reversal.",
      });
    }
    if (input.postingDate < original.action.postingDate) {
      blockers.push({
        code: "InvalidJournal",
        message: "Correction date cannot precede the original posting date.",
      });
    }
    if ((yield* Db.readVoucherByReversal(transaction, scope.bookId, voucherId)).length > 0) {
      blockers.push({
        code: "AlreadyPosted",
        message: "The original already has a reversal.",
      });
    }

    const book = yield* readBook(transaction, scope);
    const periodRows = yield* Db.readPeriod(transaction, scope.bookId, input.accountingPeriodId);
    const period = periodRows[0];
    const accountRows = yield* Db.readAllAccounts(transaction, scope.bookId);
    const periodList = yield* Db.readAllPeriods(transaction, scope.bookId);
    const yearList = yield* Db.readAllFiscalYears(transaction, scope.bookId);
    const changes = yield* netChange(transaction, scope, voucherId, input);
    if (period) {
      const reviewAction = {
        ...original.action,
        correctsVoucherId: null,
        postingPurpose: "adjustment" as const,
        occurrenceKey: "manual_journal",
        fiscalYearId: period.fiscalYearId,
        accountingPeriodId: input.accountingPeriodId,
        postingDate: input.postingDate,
        rationale: input.rationale,
        description: input.replacement.description,
        lines: input.replacement.lines.map((line, index) => ({
          ...line,
          lineId: `review_line_${index + 1}`,
        })),
      };
      const action = yield* decode(Accounting.VoucherPostingAction, reviewAction);
      const validation = yield* validateAction(transaction, scope, book, action).pipe(
        Effect.asVoid,
        Effect.mapError(databaseFailure),
        Effect.catch((error) => Effect.succeed(error)),
      );
      if (validation) blockers.push({ code: validation.code, message: validation.message });
      if (
        input.postingDate === original.action.postingDate &&
        input.accountingPeriodId === original.action.accountingPeriodId &&
        changes.length === 0
      ) {
        blockers.push({
          code: "InvalidJournal",
          message:
            "The replacement changes no supported economic amount or posting date. Description-only, reordered or split equivalent lines are not a financial correction.",
        });
      }
    } else {
      blockers.push({
        code: "InvalidJournal",
        message: "The accounting period does not belong to this book.",
      });
    }
    const configurationDigest = yield* digest({
      book: {
        id: book.id,
        entityId: book.entityId,
        name: book.name,
        currency: book.currency,
        currencyScale: book.currencyScale,
        profile: book.profile,
        profileVersion: book.profileVersion.toString(),
        writerEpoch: book.writerEpoch.toString(),
        authority: book.authority,
        committedSequence: book.committedSequence.toString(),
      },
      accounts: accountRows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        active: row.active,
        version: row.version.toString(),
      })),
      periods: periodList.map((row) => ({
        id: row.id,
        fiscalYearId: row.fiscalYearId,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        locked: row.locked,
        version: row.version.toString(),
      })),
      years: yearList,
    });
    return {
      intent: input,
      chain,
      resources,
      blockers,
      configurationDigest,
      netChange: changes,
      executable: false,
      limitations: [
        "Snapshot-current is not full executability. Approval authority and all kernel and dependent-domain guards are checked at execution.",
        "Only native synthetic manual journal economics are supported. Company date policy, tax, payroll, funding classification and statutory filing effects are not established.",
        "Only registered relationships are visible. Missing company evidence, liabilities or sources are not inferred absent. No report, match, invoice, schedule or closed period is rewritten.",
      ],
    } satisfies ImpactBasis;
  });
}

export const prepareCorrectionImpact = Effect.fn("posting.prepareCorrectionImpact")(function* (
  token: string,
  command: {
    scope: Scope;
    voucherId: string;
    idempotencyKey: string;
    input: Intent;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "prepare_correction_impact",
          principal.actorId,
          { id: command.voucherId, input: command.input },
          Corrections.CorrectionImpact,
        );
        if (request.previous) return request.previous;
        yield* Db.readAllPeriods(transaction, command.scope.bookId);
        yield* Db.readAllFiscalYears(transaction, command.scope.bookId);
        yield* Db.readAllAccounts(transaction, command.scope.bookId);
        const basis = yield* impactBasis(
          transaction,
          command.scope,
          command.voucherId,
          command.input,
        );
        const bodyWithoutDigest = {
          id: newId("impact"),
          scope: command.scope,
          voucherId: command.voucherId,
          createdBy: principal.actorId,
          createdAt: yield* isoNow(transaction),
          basis,
        };
        const bodyDigest = yield* digest(bodyWithoutDigest);
        const impact = yield* decode(Corrections.CorrectionImpact, {
          ...bodyWithoutDigest,
          digest: bodyDigest,
        });
        yield* CorrectionDb.insertImpactReview(transaction, {
          bookId: command.scope.bookId,
          id: impact.id,
          voucherId: command.voucherId,
          body: impact,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "prepare_correction_impact",
          principal.actorId,
          impact,
        );
        return impact;
      }),
    "update",
  );
});

export const getCorrectionImpact = Effect.fn("posting.getCorrectionImpact")(function* (
  token: string,
  command: { scope: Scope; impactId: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* CorrectionDb.readImpactReview(
        transaction,
        command.scope,
        command.impactId,
      ))[0];
      if (!row) return yield* failure("NotFound");
      const impact = yield* decode(Corrections.CorrectionImpact, row.body);
      const withoutDigest = Object.fromEntries(
        Object.entries(impact).filter(([key]) => key !== "digest"),
      );
      const storedDigest = impact.digest;
      if ((yield* digest(withoutDigest, "StaleDependency")) !== storedDigest) {
        return yield* failure("StaleDependency");
      }
      const current = yield* impactBasis(
        transaction,
        command.scope,
        impact.voucherId,
        impact.basis.intent,
      );
      const currentDigest = yield* digest(current);
      const storedBasisDigest = yield* digest(impact.basis);
      return {
        impact,
        snapshotCurrent: currentDigest === storedBasisDigest,
        executable: false,
      } satisfies typeof Corrections.CorrectionImpactView.Type;
    }),
  );
});

export const getCorrectionChain = Effect.fn("posting.getCorrectionChain")(function* (
  token: string,
  command: { scope: Scope; voucherId: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      return yield* correctionChain(transaction, command.scope, command.voucherId);
    }),
  );
});

export const listCorrectionBundles = Effect.fn("posting.listCorrectionBundles")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const rows = yield* CorrectionDb.listBundles(transaction, command.scope, command.after);
      const page = rows.slice(0, 25);
      const result = {
        items: page.map((row) => ({
          id: row.id,
          originalVoucherId: row.originalVoucherId,
          createdAt: row.createdAt,
          bundleDigest: row.digest,
          receipt: row.receipt,
        })),
        next: rows.length > 25 ? (page.at(-1)?.id ?? null) : null,
      };
      return yield* decode(Corrections.CorrectionBundlePage, result);
    }),
  );
});

export const recoverCorrectionRequest = Effect.fn("posting.recoverCorrectionRequest")(function* (
  token: string,
  command: { scope: Scope; key: string },
) {
  return yield* withBook(token, command.scope, false, (transaction, principal) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* Db.readCommandReceipt(
        transaction,
        command.scope.bookId,
        command.key,
        "share",
      )).find(
        (item) =>
          item.actorId === principal.actorId &&
          [
            "prepare_correction_impact",
            "prepare_correction_bundle",
            "approve_correction_bundle",
            "execute_correction_bundle",
          ].includes(item.operation),
      );
      const result = row ? yield* decode(itemSchema(row.operation), row.result) : null;
      return {
        key: command.key,
        checkedAt: yield* isoNow(transaction),
        status: row ? ("recorded" as const) : ("not_recorded_at_check" as const),
        operation: row?.operation ?? null,
        result,
      } satisfies typeof Corrections.CorrectionRequestRecovery.Type;
    }),
  );
});

function itemSchema(
  operation: string,
): Schema.Decoder<
  | typeof Corrections.CorrectionBundle.Type
  | typeof Corrections.CorrectionBundleApproval.Type
  | typeof Corrections.CorrectionBundleReceipt.Type
  | Impact
> {
  if (operation === "prepare_correction_impact") return Corrections.CorrectionImpact;
  if (operation === "prepare_correction_bundle") return Corrections.CorrectionBundle;
  if (operation === "approve_correction_bundle") return BundleApproval;
  return BundleReceipt;
}

function readBundleState(
  transaction: Transaction,
  scope: Scope,
  bundle: typeof Corrections.CorrectionBundle.Type,
) {
  return Effect.gen(function* () {
    yield* validateBundle(bundle);
    if (bundle.impactReview) {
      const impactRow = (yield* CorrectionDb.readImpactReview(
        transaction,
        scope,
        bundle.impactReview.id,
      ))[0];
      if (!impactRow) return yield* failure("StaleDependency");
      const impact = yield* decode(Corrections.CorrectionImpact, impactRow.body);
      const impactWithoutDigest = Object.fromEntries(
        Object.entries(impact).filter(([key]) => key !== "digest"),
      );
      const storedDigest = impact.digest;
      if (
        impact.voucherId !== bundle.originalVoucher.id ||
        impact.digest !== bundle.impactReview.digest ||
        (yield* digest(impactWithoutDigest, "StaleDependency")) !== storedDigest
      ) {
        return yield* failure("StaleDependency");
      }
      const current = yield* impactBasis(
        transaction,
        scope,
        bundle.originalVoucher.id,
        impact.basis.intent,
      );
      if ((yield* digest(current)) !== (yield* digest(impact.basis))) {
        return yield* failure("StaleDependency");
      }
      const blocker = current.blockers[0];
      if (blocker) return yield* failure(blocker.code);
    }
    const reversalRows = yield* Db.readPlan(transaction, scope.bookId, bundle.reversal.id);
    const replacementRows = yield* Db.readPlan(transaction, scope.bookId, bundle.replacement.id);
    const reversalRow = reversalRows[0];
    const replacementRow = replacementRows[0];
    if (!reversalRow || !replacementRow) return yield* failure("NotFound");
    const reversal = yield* decode(Accounting.ChangeSet, reversalRow.plan);
    const replacement = yield* decode(Accounting.ChangeSet, replacementRow.plan);
    yield* validatePlan(transaction, scope, reversal);
    yield* validatePlan(transaction, scope, replacement);
  });
}

export const prepareCorrectionBundle = Effect.fn("posting.prepareCorrectionBundle")(function* (
  token: string,
  command: {
    scope: Scope;
    voucherId: string;
    idempotencyKey: string;
    input: typeof Corrections.PrepareCorrectionBundle.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "prepare_correction_bundle",
          principal.actorId,
          { id: command.voucherId, input: command.input },
          Corrections.CorrectionBundle,
        );
        if (request.previous) return request.previous;
        if (!command.input.impactReview) return yield* failure("UnsupportedProfile");
        const original = yield* readVoucher(transaction, command.scope, command.voucherId);
        if (original.action.postingPurpose === "reversal") return yield* failure("InvalidJournal");
        if (original.action.postingPurpose !== "adjustment") {
          return yield* failure("UnsupportedProfile");
        }
        if (command.input.postingDate < original.action.postingDate) {
          return yield* failure("InvalidJournal");
        }
        if (
          (yield* Db.readVoucherByReversal(transaction, command.scope.bookId, command.voucherId))
            .length > 0
        ) {
          return yield* failure("AlreadyPosted");
        }
        const impactRow = (yield* CorrectionDb.readImpactReview(
          transaction,
          command.scope,
          command.input.impactReview.id,
        ))[0];
        if (!impactRow) return yield* failure("StaleDependency");
        const impact = yield* decode(Corrections.CorrectionImpact, impactRow.body);
        const impactWithoutDigest = Object.fromEntries(
          Object.entries(impact).filter(([key]) => key !== "digest"),
        );
        const storedImpactDigest = impact.digest;
        const intent = {
          datePolicy: command.input.datePolicy,
          accountingPeriodId: command.input.accountingPeriodId,
          postingDate: command.input.postingDate,
          rationale: command.input.rationale,
          replacement: command.input.replacement,
        } satisfies Intent;
        const current = yield* impactBasis(transaction, command.scope, command.voucherId, intent);
        if (
          impact.voucherId !== command.voucherId ||
          impact.digest !== command.input.impactReview.digest ||
          (yield* digest(impactWithoutDigest, "StaleDependency")) !== storedImpactDigest ||
          (yield* digest(current)) !== (yield* digest(impact.basis))
        ) {
          return yield* failure("StaleDependency");
        }
        const blocker = current.blockers[0];
        if (blocker) return yield* failure(blocker.code);

        const period = yield* readPeriod(
          transaction,
          command.scope,
          command.input.accountingPeriodId,
        );
        const book = yield* readBook(transaction, command.scope);
        const reversalValue = {
          ...original.action,
          correctsVoucherId: command.voucherId,
          postingPurpose: "reversal" as const,
          occurrenceKey: command.voucherId,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: command.input.accountingPeriodId,
          postingDate: command.input.postingDate,
          description: `Reversal: ${original.action.description.slice(0, 1990)}`,
          rationale: command.input.rationale,
          lines: original.action.lines.map((line) => ({
            ...line,
            lineId: newId("line"),
            debitMinor: line.creditMinor,
            creditMinor: line.debitMinor,
          })),
        };
        const sourceEvidenceId = original.action.evidenceRefs[0]?.evidenceId;
        if (!sourceEvidenceId) return yield* failure("MissingEvidence");
        const eventRows = yield* Db.readEvent(
          transaction,
          command.scope.bookId,
          sourceEvidenceId,
          `correction:${command.voucherId}`,
        );
        const replacementEventId = eventRows[0]?.id ?? newId("event");
        if (eventRows.length === 0) {
          yield* Db.insertEvent(
            transaction,
            command.scope.bookId,
            replacementEventId,
            sourceEvidenceId,
            `correction:${command.voucherId}`,
          );
        }
        const replacementValue = {
          ...original.action,
          eventId: replacementEventId,
          correctsVoucherId: null,
          postingPurpose: "adjustment" as const,
          occurrenceKey: "manual_journal",
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: command.input.accountingPeriodId,
          postingDate: command.input.postingDate,
          description: command.input.replacement.description,
          rationale: command.input.rationale,
          lines: command.input.replacement.lines.map((line) => ({
            ...line,
            lineId: newId("line"),
          })),
        };
        const reversal = yield* decode(Accounting.VoucherPostingAction, reversalValue);
        const replacement = yield* decode(Accounting.VoucherPostingAction, replacementValue);
        yield* validateAction(transaction, command.scope, book, reversal);
        yield* validateAction(transaction, command.scope, book, replacement);
        const reversalPlan = yield* makePlan(transaction, command.scope, principal, reversal);
        const replacementPlan = yield* makePlan(transaction, command.scope, principal, replacement);
        const bodyWithoutDigest = {
          id: newId("correction"),
          version: 1 as const,
          scope: command.scope,
          impactReview: command.input.impactReview,
          originalVoucher: original,
          datePolicy: command.input.datePolicy,
          rationale: command.input.rationale,
          reversal: reversalPlan,
          replacement: replacementPlan,
          createdBy: principal.actorId,
          createdAt: yield* isoNow(transaction),
        };
        const bundleDigest = yield* digest(bodyWithoutDigest);
        const bundle = yield* decode(Corrections.CorrectionBundle, {
          ...bodyWithoutDigest,
          bundleDigest,
        });
        yield* CorrectionDb.insertBundle(transaction, {
          bookId: command.scope.bookId,
          id: bundle.id,
          originalVoucherId: command.voucherId,
          reversalChangeSetId: reversalPlan.id,
          replacementChangeSetId: replacementPlan.id,
          body: bundle,
          digest: bundleDigest,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "prepare_correction_bundle",
          principal.actorId,
          bundle,
        );
        return bundle;
      }),
    "update",
  );
});

function bundleView(
  transaction: Transaction,
  scope: Scope,
  bundle: typeof Corrections.CorrectionBundle.Type,
) {
  return Effect.gen(function* () {
    const receiptRow = (yield* CorrectionDb.readBundleReceipt(transaction, scope, bundle.id))[0];
    const receipt = receiptRow ? yield* decode(BundleReceipt, receiptRow.body) : null;
    const approvalRow = (yield* CorrectionDb.readLatestBundleApproval(
      transaction,
      scope,
      bundle.id,
    ))[0];
    let approval: typeof Corrections.CorrectionBundleApproval.Type | null = null;
    if (approvalRow && !receipt) {
      const candidate = yield* decode(BundleApproval, approvalRow.body);
      const reversal = (yield* Db.readApproval(
        transaction,
        scope.bookId,
        approvalRow.reversalApprovalId,
      ))[0];
      const replacement = (yield* Db.readApproval(
        transaction,
        scope.bookId,
        approvalRow.replacementApprovalId,
      ))[0];
      const now = yield* Db.readDatabaseTime(transaction);
      if (
        candidate.bundleDigest === bundle.bundleDigest &&
        candidate.bundleId === bundle.id &&
        reversal?.changeSetId === bundle.reversal.id &&
        reversal.digest === bundle.reversal.planDigest &&
        replacement?.changeSetId === bundle.replacement.id &&
        replacement.digest === bundle.replacement.planDigest &&
        reversal.actorId === candidate.actorId &&
        replacement.actorId === candidate.actorId &&
        reversal.consumedAt === null &&
        replacement.consumedAt === null &&
        Date.parse(candidate.expiresAt) > Date.parse(now.now) &&
        (yield* Db.readOperatorMembership(transaction, scope.bookId, candidate.actorId)).length >
          0 &&
        (yield* Db.readActorAdmission(transaction, candidate.actorId))[0]?.enabled !== false &&
        (yield* Db.readApprovalRevocation(transaction, scope.bookId, reversal.id)).length === 0 &&
        (yield* Db.readApprovalRevocation(transaction, scope.bookId, replacement.id)).length === 0
      ) {
        approval = candidate;
      }
    }
    return { bundle, approval, receipt } satisfies typeof Corrections.CorrectionBundleView.Type;
  });
}

function validateBundleRow(
  row: CorrectionDb.BundleRow,
  bundle: typeof Corrections.CorrectionBundle.Type,
) {
  return row.originalVoucherId === bundle.originalVoucher.id &&
    row.reversalChangeSetId === bundle.reversal.id &&
    row.replacementChangeSetId === bundle.replacement.id
    ? Effect.succeed(bundle)
    : failure("StaleDependency");
}

function readBundleView(transaction: Transaction, scope: Scope, bundleId: string) {
  return Effect.gen(function* () {
    const row = (yield* CorrectionDb.readBundle(transaction, scope, bundleId))[0];
    if (!row) return yield* failure("NotFound");
    const bundle = yield* bundleFromRow(row);
    yield* validateBundle(bundle);
    yield* validateBundleRow(row, bundle);
    return yield* bundleView(transaction, scope, bundle);
  });
}

export const getCorrectionBundle = Effect.fn("posting.getCorrectionBundle")(function* (
  token: string,
  command: { scope: Scope; bundleId: string },
) {
  return yield* withBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* Db.lockBookForShare(transaction, command.scope);
      return yield* readBundleView(transaction, command.scope, command.bundleId);
    }),
  );
});

export const getCorrectionBundleForVoucher = Effect.fn("posting.getCorrectionBundleForVoucher")(
  function* (token: string, command: { scope: Scope; voucherId: string }) {
    return yield* withBook(token, command.scope, false, (transaction) =>
      Effect.gen(function* () {
        yield* Db.lockBookForShare(transaction, command.scope);
        yield* readVoucher(transaction, command.scope, command.voucherId);
        const row = (yield* CorrectionDb.readBundleForVoucher(
          transaction,
          command.scope,
          command.voucherId,
        ))[0];
        if (!row) return yield* failure("NotFound");
        const bundle = yield* bundleFromRow(row);
        yield* validateBundle(bundle);
        yield* validateBundleRow(row, bundle);
        return yield* bundleView(transaction, command.scope, bundle);
      }),
    );
  },
);

export const approveCorrectionBundle = Effect.fn("posting.approveCorrectionBundle")(function* (
  token: string,
  command: {
    scope: Scope;
    bundleId: string;
    idempotencyKey: string;
    input: typeof Corrections.ApproveCorrectionBundle.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "approve_correction_bundle",
          principal.actorId,
          { id: command.bundleId, input: command.input },
          BundleApproval,
        );
        if (request.previous) return request.previous;
        const row = (yield* CorrectionDb.readBundle(
          transaction,
          command.scope,
          command.bundleId,
          "update",
        ))[0];
        if (!row) return yield* failure("NotFound");
        const bundle = yield* bundleFromRow(row);
        yield* validateBundle(bundle);
        yield* validateBundleRow(row, bundle);
        if (
          command.input.bundleDigest !== bundle.bundleDigest ||
          command.input.version !== bundle.version
        ) {
          return yield* failure("StaleDependency");
        }
        yield* readBundleState(transaction, command.scope, bundle);
        if (
          (yield* CorrectionDb.readBundleReceipt(transaction, command.scope, bundle.id)).length > 0
        ) {
          return yield* failure("AlreadyPosted");
        }
        const now = yield* Db.readDatabaseTime(transaction);
        const expiresAt = new Date(Date.parse(now.now) + 60 * 60 * 1000).toISOString();
        const approval = yield* decode(BundleApproval, {
          id: newId("bundleapproval"),
          bundleId: bundle.id,
          bundleDigest: bundle.bundleDigest,
          actorId: principal.actorId,
          expiresAt,
        });
        const reversalApproval = yield* Db.insertApproval(transaction, {
          bookId: command.scope.bookId,
          id: newId("approval"),
          changeSetId: bundle.reversal.id,
          digest: bundle.reversal.planDigest,
          actorId: principal.actorId,
          expiresAt,
        });
        const replacementApproval = yield* Db.insertApproval(transaction, {
          bookId: command.scope.bookId,
          id: newId("approval"),
          changeSetId: bundle.replacement.id,
          digest: bundle.replacement.planDigest,
          actorId: principal.actorId,
          expiresAt,
        });
        const reversalApprovalId = reversalApproval[0]?.id;
        const replacementApprovalId = replacementApproval[0]?.id;
        if (!reversalApprovalId || !replacementApprovalId) {
          return yield* failure("InternalError");
        }
        yield* CorrectionDb.insertBundleApproval(transaction, {
          bookId: command.scope.bookId,
          id: approval.id,
          bundleId: bundle.id,
          reversalApprovalId,
          replacementApprovalId,
          expiresAt,
          body: approval,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "approve_correction_bundle",
          principal.actorId,
          approval,
        );
        return approval;
      }),
    "update",
  );
});

export const executeCorrectionBundle = Effect.fn("posting.executeCorrectionBundle")(function* (
  token: string,
  command: {
    scope: Scope;
    bundleId: string;
    idempotencyKey: string;
    input: typeof Corrections.ExecuteCorrectionBundle.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "execute_correction_bundle",
          principal.actorId,
          { id: command.bundleId, input: command.input },
          BundleReceipt,
        );
        if (request.previous) return request.previous;
        const bundleRow = (yield* CorrectionDb.readBundle(
          transaction,
          command.scope,
          command.bundleId,
        ))[0];
        if (!bundleRow) return yield* failure("NotFound");
        const bundle = yield* bundleFromRow(bundleRow);
        yield* validateBundle(bundle);
        yield* validateBundleRow(bundleRow, bundle);
        if (
          command.input.bundleDigest !== bundle.bundleDigest ||
          command.input.version !== bundle.version
        ) {
          return yield* failure("StaleDependency");
        }
        const existing = (yield* CorrectionDb.readBundleReceipt(
          transaction,
          command.scope,
          bundle.id,
        ))[0];
        if (existing) {
          if (command.input.approvalId !== existing.approvalId) {
            return yield* failure("ApprovalRequired");
          }
          const result = yield* decode(BundleReceipt, existing.body);
          yield* saveCommand(
            transaction,
            command.scope,
            command.idempotencyKey,
            request.expected,
            "execute_correction_bundle",
            principal.actorId,
            result,
          );
          return result;
        }
        yield* readBundleState(transaction, command.scope, bundle);
        const approvalRow = (yield* CorrectionDb.readBundleApproval(
          transaction,
          command.scope,
          bundle.id,
          command.input.approvalId,
          "update",
        ))[0];
        if (!approvalRow) return yield* failure("ApprovalRequired");
        const approval = yield* decode(BundleApproval, approvalRow.body);
        if (
          approval.bundleId !== bundle.id ||
          approval.bundleDigest !== bundle.bundleDigest ||
          (yield* Db.readOperatorMembership(transaction, command.scope.bookId, approval.actorId))
            .length === 0 ||
          (yield* Db.readActorAdmission(transaction, approval.actorId))[0]?.enabled === false
        ) {
          return yield* failure("ApprovalRequired");
        }
        const now = yield* Db.readDatabaseTime(transaction);
        if (Date.parse(approval.expiresAt) <= Date.parse(now.now)) {
          return yield* failure("ApprovalRequired");
        }
        const reversal = yield* executeChangeInTransaction(transaction, principal, {
          scope: command.scope,
          changeSetId: bundle.reversal.id,
          idempotencyKey: newId("bundlecommand"),
          input: {
            planDigest: bundle.reversal.planDigest,
            version: bundle.reversal.version,
            approvalId: approvalRow.reversalApprovalId,
          },
          allowCorrectionChild: true,
        });
        const replacement = yield* executeChangeInTransaction(transaction, principal, {
          scope: command.scope,
          changeSetId: bundle.replacement.id,
          idempotencyKey: newId("bundlecommand"),
          input: {
            planDigest: bundle.replacement.planDigest,
            version: bundle.replacement.version,
            approvalId: approvalRow.replacementApprovalId,
          },
          allowCorrectionChild: true,
        });
        const result = yield* decode(BundleReceipt, {
          id: newId("bundlereceipt"),
          bundleId: bundle.id,
          bundleDigest: bundle.bundleDigest,
          approvalId: approval.id,
          originalVoucherId: bundle.originalVoucher.id,
          reversal,
          replacement,
          committedAt: yield* isoNow(transaction),
        });
        yield* CorrectionDb.insertBundleReceipt(transaction, {
          bookId: command.scope.bookId,
          bundleId: bundle.id,
          originalVoucherId: bundle.originalVoucher.id,
          approvalId: approval.id,
          reversalReceiptId: reversal.id,
          replacementReceiptId: replacement.id,
          body: result,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "execute_correction_bundle",
          principal.actorId,
          result,
        );
        return result;
      }),
    "update",
  );
});

export type { Impact };
