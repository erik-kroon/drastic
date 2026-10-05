import * as Contracts from "@open-erp/contracts/historical-adoptions";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Domain from "@open-erp/domain/historical-adoptions";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Match from "effect/Match";
import * as Db from "../../db/historical-adoptions";
import * as HistoricalDb from "../../db/historical";
import * as Ledger from "../../db/posting";
import * as SieDb from "../../db/sie-import";
import * as SieContracts from "@open-erp/contracts/sie-import";
import * as PartitionsDb from "../../db/sie-partitions";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand } from "../posting";
import { readBasis, readPlan } from "./historical-shared";
import { readPartition } from "./partitions";

export const readPool = Effect.fn("historical.readPool")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readPool(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  return yield* decode(Contracts.Pool, row.body);
});

export const assertPoolBasis = Effect.fn("historical.assertPoolBasis")(function* (
  tx: Transaction,
  scope: Scope,
  pool: typeof Contracts.Pool.Type,
) {
  if (
    (yield* Db.readLiveRun(tx, scope.bookId)).length ||
    (yield* Db.readNativeDuplicates(tx, scope.bookId, pool.controlAccountId, pool.input.cutoverOn))
      .length
  )
    return yield* failure("StaleDependency");

  const actual =
    (yield* HistoricalDb.readBalances(tx, scope.bookId, pool.input.cutoverOn, true)).find(
      (row) => row.accountId === pool.controlAccountId,
    )?.amount ?? "0";

  const signed =
    pool.input.direction === "AR"
      ? BigInt(pool.exactResidualMinor)
      : -BigInt(pool.exactResidualMinor);

  if (BigInt(actual) !== signed) return yield* failure("StaleDependency");
});

export const domainPool = Effect.fn("historical.domainPool")(function* (
  tx: Transaction,
  scope: Scope,
  pool: typeof Contracts.Pool.Type,
) {
  yield* assertPoolBasis(tx, scope, pool);
  const rows = yield* Db.readAdoptions(tx, scope.bookId, pool.id);
  const adoptions = yield* Effect.forEach(rows, (row) => decode(Contracts.Adoption, row.body));

  const version = yield* digest(
    adoptions.map((row) => ({ id: row.id, amountMinor: row.openingResidualMinor })),
  );

  const control: Domain.ControlPool = {
    poolId: pool.id,
    bookId: scope.bookId,
    historicalBasisId: pool.sourcePlanId,
    cutoverOn: pool.input.cutoverOn,
    direction: pool.input.direction,
    currency: pool.currency,
    controlAccountId: pool.controlAccountId,
    exactReviewedResidualMinor: pool.exactResidualMinor,
    glBasisVerified: true,
    independentTotalVerified: true,
    partitionDigest: pool.partitionDigest,
    partitionComplete: true,
    poolVersion: version,
  };

  return { control, adoptions, version };
});

const sourceResiduals = Effect.fn("historical.sourceResiduals")(function* (
  admission: typeof Historical.ItemAdmission.Type,
  items: typeof Historical.ItemAdmission.Type.openItems,
  sourcePlanId: string,
  direction: Domain.PoolDirection,
  currency: string,
  accountId: string,
) {
  const sourceItems: Array<Domain.SourceItem> = [];

  for (const item of items) {
    const residual = BigInt(item.outstandingMinor);

    const payments = admission.matches
      .filter((row) => row.itemIdentity === item.sourceIdentity)
      .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);

    const original = BigInt(item.originalMinor),
      absoluteOriginal = original < 0n ? -original : original,
      absoluteResidual = residual < 0n ? -residual : residual;

    if (
      item.detailAvailability === "source_asserted" &&
      absoluteOriginal - payments !== absoluteResidual
    )
      return yield* failure("InvalidJournal");
    sourceItems.push({
      sourceIdentity: item.sourceIdentity,
      historicalBasisId: sourcePlanId,
      direction: direction,
      currency: currency,
      controlAccountId: accountId,
      originalFace:
        item.detailAvailability === "source_asserted"
          ? { kind: "known", amountMinor: absoluteOriginal.toString() }
          : { kind: "unknown" },
      priorPayments:
        item.detailAvailability === "source_asserted"
          ? { kind: "known", amountMinor: payments.toString() }
          : { kind: "unknown" },
      residualAtCutover: {
        kind: "evidenced",
        amountMinor: absoluteResidual.toString(),
        evidenceId: admission.id,
      },
      sourceIssueOn: null,
    });
  }

  return sourceItems;
});

const requireUnusedPoolControl = Effect.fn("historical.requireUnusedPoolControl")(function* (
  tx: Transaction,
  scope: Scope,
  accountId: string,
  input: typeof Contracts.CreatePool.Type,
) {
  if ((yield* Db.readPoolForControl(tx, scope.bookId, accountId, input.direction)).length)
    return yield* failure("AlreadyPosted");
});

const readAdmissionControl = Effect.fn("historical.readAdmissionControl")(function* (
  tx: Transaction,
  scope: Scope,
  sourcePlanId: string,
  sourceAccount: string,
) {
  const plan = yield* readPlan(tx, scope, sourcePlanId);

  const accountId = plan.input.mappings.find(
    (row) => row.sourceAccount === sourceAccount,
  )?.accountId;

  if (!accountId) return yield* failure("InvalidJournal");

  return { plan, accountId };
});

export const createHistoricalPool = Effect.fn("historical.createPool")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Contracts.CreatePool.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command,
        operation = "create_historical_pool";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Contracts.Pool,
      );

      if (request.previous) return request.previous;
      const row = (yield* HistoricalDb.readItems(tx, scope.bookId, input.admissionId))[0];

      if (!row) return yield* failure("NotFound");
      const admission = yield* decode(Historical.ItemAdmission, row.body);

      if (admission.digest !== input.admissionDigest) return yield* failure("StaleDependency");

      const { plan, accountId } = yield* readAdmissionControl(
        tx,
        scope,
        admission.sourcePlanId,
        input.sourceAccount,
      );

      yield* requireUnusedPoolControl(tx, scope, accountId, input);
      const basis = yield* readBasis(tx, scope, input.basisFiscalYearId);
      const previewRow = (yield* SieDb.readPreview(tx, scope.bookId, plan.previewId))[0];

      if (!previewRow) return yield* failure("MissingEvidence");
      const preview = yield* decode(SieContracts.SiePreview, previewRow.body);
      const occurrence = (yield* SieDb.readSource(tx, scope.bookId, preview.occurrenceId))[0];

      if (!occurrence) return yield* failure("MissingEvidence");
      const book = (yield* Ledger.readBook(tx, scope))[0];

      if (
        !book ||
        book.profile !== "synthetic-core-v1" ||
        basis.sourcePlanId !== admission.sourcePlanId ||
        basis.sourceDigest !== plan.digest
      )
        return yield* failure("UnsupportedProfile");

      if (basis.mode === "opening_set") {
        if (!basis.voucherId || basis.cutoverOn !== input.cutoverOn)
          return yield* failure("ApprovalRequired");
      } else {
        const run = (yield* Db.readPostedRun(tx, scope.bookId, plan.id))[0];

        if (!run) return yield* failure("ApprovalRequired");

        if (run.partitionId) {
          const partition = yield* readPartition(tx, scope, run.partitionId);
          const comparisons = yield* PartitionsDb.readYearComparisons(tx, scope.bookId, run.id);

          if (
            partition.years.at(-1)?.endsOn !== input.cutoverOn ||
            comparisons.length !== partition.years.length
          )
            return yield* failure("StaleDependency");
        } else {
          const year = (yield* Ledger.readFiscalYear(tx, scope.bookId, input.basisFiscalYearId))[0];

          if (!year || year.endsOn !== input.cutoverOn) return yield* failure("InvalidJournal");
        }
      }

      if ((yield* Db.readPoolForSource(tx, scope.bookId, admission.id, input.sourceAccount)).length)
        return yield* failure("AlreadyPosted");

      const control = admission.openItemControls.filter(
        (row) => row.sourceAccount === input.sourceAccount,
      );

      const items = admission.openItems.filter((row) => row.sourceAccount === input.sourceAccount);

      if (
        !accountId ||
        items.length === 0 ||
        control.length !== 1 ||
        control[0]!.currency !== book.currency ||
        items.some(
          (row) =>
            row.currency !== book.currency ||
            row.asOf !== input.cutoverOn ||
            (input.direction === "AR"
              ? BigInt(row.outstandingMinor) < 0n
              : BigInt(row.outstandingMinor) > 0n),
        )
      )
        return yield* failure("UnsupportedProfile");

      const sourceItems = yield* sourceResiduals(
        admission,
        items,
        plan.id,
        input.direction,
        book.currency,
        accountId,
      );

      const exact = sourceItems.reduce(
        (sum, row) =>
          sum +
          (row.residualAtCutover.kind === "evidenced"
            ? BigInt(row.residualAtCutover.amountMinor)
            : 0n),
        0n,
      );

      const signed = input.direction === "AR" ? exact : -exact;

      if (exact <= 0n || signed !== BigInt(control[0]!.independentOutstandingMinor))
        return yield* failure("InvalidJournal");

      const body = {
        id: newId("historicalpool"),
        scope,
        input,
        sourcePlanId: plan.id,
        sourceSystem: occurrence.sourceSystem,
        basisMode: basis.mode,
        controlAccountId: accountId,
        currency: book.currency,
        exactResidualMinor: exact.toString(),
        partitionDigest: yield* digest({
          admissionDigest: admission.digest,
          sourceItems,
          control: control[0]!,
        }),
        sourceItems,
        basisDigest: yield* digest(basis),
        createdBy: principal.actorId,
        createdAt: yield* isoNow(tx),
      };

      const result = yield* decode(Contracts.Pool, { ...body, digest: yield* digest(body) });
      yield* assertPoolBasis(tx, scope, result);
      yield* Db.insertPool(tx, scope.bookId, result);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export function checkedAdoption<A>(result: Domain.Checked<A>) {
  if (Result.isSuccess(result)) return Effect.succeed(result.success);
  const code = result.failure.code;

  return failure(
    Match.value(code).pipe(
      Match.when("AlreadyAdopted", () => "AlreadyPosted" as const),
      Match.when("UnsupportedCreditDetail", () => "UnsupportedProfile" as const),
      Match.when("StaleAdoptionBasis", () => "StaleDependency" as const),
      Match.orElse(() => "InvalidJournal" as const),
    ),
  );
}
