import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Effect from "effect/Effect";
import type { Transaction } from "../../db/transaction";
import * as Db from "../../db/subledger/assets";
import * as Ledger from "../../db/posting";
import * as Schedules from "../../db/subledger/schedules";
import * as Bases from "../../db/subledger/controls";
import { decode, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { readBook } from "../posting";
import {
  basisMatchesRevision,
  readOccurrenceStates,
  readPostingBasis,
  type OccurrenceState,
} from "./schedules";

type ImpairmentInput = typeof Controls.PrepareAssetImpairment.Type;

type DisposalInput = typeof Controls.PrepareAssetDisposal.Type;

const scanConsumed = Effect.fn("subledger.scanAssetOccurrences")(function* (
  tx: Transaction,
  scope: Scope,
  input: ImpairmentInput | DisposalInput,
  occurrences: ReadonlyArray<OccurrenceState>,
) {
  let recognized = 0n;
  let reversed = 0n;
  let lastConsumed = "";
  let suffix = false;
  let prefixCount = 0;

  for (const state of occurrences) {
    if (!["unprepared", "prepared", "posted", "reversed"].includes(state.state))
      return yield* failure("UnsupportedProfile");

    if (
      state.voucherId &&
      (yield* Schedules.readCorrectionForVoucher(tx, scope.bookId, state.voucherId)).length
    )
      return yield* failure("UnsupportedProfile");

    if (state.state === "posted" || state.state === "reversed") {
      if (input.profile === "synthetic_asset_impairment_v1" && suffix)
        return yield* failure("UnsupportedProfile");
      prefixCount++;

      if (state.postingDate > input.postingDate) return yield* failure("UnsupportedProfile");

      if (state.postingDate > lastConsumed) lastConsumed = state.postingDate;

      if (state.state === "posted") {
        recognized += BigInt(state.amountMinor);
        continue;
      }

      const voucher =
        state.reversalVoucherId === null
          ? undefined
          : (yield* Ledger.readVoucher(tx, scope.bookId, state.reversalVoucherId))[0];

      if (
        !voucher ||
        voucher.postingPurpose !== "reversal" ||
        voucher.postingDate > input.postingDate
      )
        return yield* failure("UnsupportedProfile");
      reversed += BigInt(state.amountMinor);

      if (voucher.postingDate > lastConsumed) lastConsumed = voucher.postingDate;
      continue;
    }

    suffix = true;

    if (
      input.profile === "synthetic_no_proceeds_asset_disposal_v1" &&
      state.postingDate < input.postingDate
    )
      return yield* failure("UnsupportedProfile");
  }

  return { recognized, reversed, lastConsumed, suffix, prefixCount };
});

const capture = Effect.fn("subledger.captureAssetBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: ImpairmentInput | DisposalInput,
) {
  const book = yield* readBook(tx, scope);

  if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
    return yield* failure("UnsupportedProfile");
  const saved = (yield* Schedules.readCurrentRevision(tx, scope.bookId, input.scheduleId))[0];

  if (!saved) return yield* failure("NotFound");
  const schedule = yield* decode(Subledgers.ScheduleRevision, saved.body);
  const row = (yield* Schedules.readBasis(tx, scope.bookId, input.scheduleId))[0];

  if (!row || schedule.terms.kind !== "asset") return yield* failure("UnsupportedProfile");
  const basis = yield* decode(Controls.SubledgerBasis, row.body);

  if ((yield* Schedules.readDisposal(tx, scope.bookId, input.scheduleId)).length)
    return yield* failure("AlreadyPosted");

  if (
    schedule.digest !== input.expectedDigest ||
    basis.digest !== input.expectedBasisDigest ||
    !(yield* basisMatchesRevision(basis, schedule)) ||
    (yield* Schedules.readReversalForVoucher(tx, scope.bookId, basis.input.voucherId)).length
  )
    return yield* failure("StaleDependency");

  if (input.postingDate < basis.input.effectiveOn) return yield* failure("InvalidJournal");
  const occurrences = yield* readOccurrenceStates(tx, scope, schedule, "9999-12-31");

  if (occurrences.length !== schedule.occurrences.length)
    return yield* failure("UnsupportedProfile");

  const scan = yield* scanConsumed(tx, scope, input, occurrences);

  const impairments = yield* Effect.forEach(
    yield* Db.listEffects(tx, scope.bookId, "impairment", input.scheduleId),
    (effect) => decode(Subledgers.AssetImpairment, effect.body),
  );

  if (impairments.some((effect) => effect.postingDate > input.postingDate))
    return yield* failure("StaleDependency");
  const prior = impairments.reduce((sum, effect) => sum + BigInt(effect.impairmentMinor), 0n);
  const carrying = BigInt(basis.input.carryingMinor) - scan.recognized - prior;
  const source = (yield* Ledger.readEvidence(tx, scope.bookId, input.evidenceId))[0];
  const review = (yield* Ledger.readEvidence(tx, scope.bookId, input.reviewEvidenceId))[0];

  if (!source || !review) return yield* failure("MissingEvidence");

  const ids = [
    ...new Set([
      ...basis.lines.map((line) => line.accountId),
      schedule.terms.debitAccountId,
      schedule.terms.creditAccountId,
      input.lossAccountId,
      ...impairments.map((i) => i.accumulatedImpairmentAccountId),
      ...("accumulatedImpairmentAccountId" in input ? [input.accumulatedImpairmentAccountId] : []),
    ]),
  ];

  const accounts = yield* Ledger.readAccounts(tx, scope.bookId, ids);
  const reserved = new Set((yield* Db.readReservedAccounts(tx, scope.bookId)).map((row) => row.id));

  if (accounts.length !== ids.length || accounts.some((a) => !a.active || reserved.has(a.id)))
    return yield* failure("InvalidJournal");

  return {
    schedule,
    basis,
    occurrences,
    impairments,
    prior,
    carrying,
    source,
    review,
    ...scan,
  };
});

export const impairmentBasis = Effect.fn("subledger.impairmentBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: ImpairmentInput,
) {
  const state = yield* capture(tx, scope, input);

  if (!state.suffix || !(yield* readPostingBasis(tx, scope, state.schedule)).supported)
    return yield* failure("StaleDependency");

  const impaired = BigInt(input.impairmentMinor),
    post = state.carrying - impaired,
    future = post - BigInt(input.residualMinor);

  if (
    impaired <= 0n ||
    impaired >= state.carrying ||
    future <= 0n ||
    BigInt(input.futureMinor) !== future ||
    input.installments.reduce((sum, period) => sum + BigInt(period.amountMinor), 0n) !== future
  )
    return yield* failure("InvalidJournal");

  const existing = new Set([
    state.schedule.terms.debitAccountId,
    state.schedule.terms.creditAccountId,
    ...state.basis.lines.map((line) => line.accountId),
  ]);

  if (
    input.lossAccountId === input.accumulatedImpairmentAccountId ||
    existing.has(input.lossAccountId) ||
    existing.has(input.accumulatedImpairmentAccountId) ||
    state.impairments.some(
      (effect) => effect.accumulatedImpairmentAccountId !== input.accumulatedImpairmentAccountId,
    )
  )
    return yield* failure("InvalidJournal");

  return yield* decode(Controls.AssetImpairmentBasis, {
    schedule: state.schedule,
    carryingBasis: state.basis,
    occurrences: state.occurrences,
    originalCostMinor: state.basis.input.originalCostMinor,
    openingAccumulatedMinor: state.basis.input.accumulatedMinor,
    recognizedMinor: state.recognized.toString(),
    reversedMinor: state.reversed.toString(),
    priorImpairmentMinor: state.prior.toString(),
    currentCarryingMinor: state.carrying.toString(),
    postImpairmentCarryingMinor: post.toString(),
    futureMinor: future.toString(),
    residualMinor: input.residualMinor,
    sourceSha256: state.source.sha256,
    reviewSha256: state.review.sha256,
  });
});

export const disposalBasis = Effect.fn("subledger.disposalBasis")(function* (
  tx: Transaction,
  scope: Scope,
  input: DisposalInput,
) {
  const state = yield* capture(tx, scope, input);
  const basis = state.basis;
  const schedule = state.schedule;

  const gross = BigInt(basis.input.originalCostMinor),
    opening = BigInt(basis.input.accumulatedMinor);

  const retained = yield* Bases.readBasisLines(
    tx,
    scope.bookId,
    basis.input.voucherId,
    basis.lines.map((line) => line.lineId),
  );

  if (
    state.carrying < 0n ||
    gross !== opening + BigInt(schedule.terms.costMinor) ||
    retained.length !== basis.lines.length ||
    basis.lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n) !== gross ||
    basis.lines.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n) !== opening ||
    basis.lines.some(
      (line) =>
        (BigInt(line.debitMinor) > 0n && line.accountId === schedule.terms.creditAccountId) ||
        (BigInt(line.creditMinor) > 0n && line.accountId !== schedule.terms.creditAccountId) ||
        !retained.some(
          (r) =>
            r.lineId === line.lineId &&
            r.ordinal === line.ordinal &&
            r.accountId === line.accountId &&
            r.debitMinor === line.debitMinor &&
            r.creditMinor === line.creditMinor,
        ),
    )
  )
    return yield* failure("UnsupportedProfile");
  const controls = new Set((yield* Db.readCarryingAccounts(tx, scope.bookId)).map((row) => row.id));

  if (
    controls.has(input.lossAccountId) ||
    state.impairments.some(
      (effect) => effect.accumulatedImpairmentAccountId === input.lossAccountId,
    )
  )
    return yield* failure("InvalidJournal");

  const contra = [
    ...new Set(state.impairments.map((effect) => effect.accumulatedImpairmentAccountId)),
  ];

  if (contra.length > 1) return yield* failure("UnsupportedProfile");

  return yield* decode(Controls.AssetDisposalBasis, {
    schedule,
    carryingBasis: basis,
    occurrences: state.occurrences,
    originalCostMinor: gross.toString(),
    openingAccumulatedMinor: opening.toString(),
    recognizedMinor: state.recognized.toString(),
    reversedMinor: state.reversed.toString(),
    impairmentMinor: state.prior.toString(),
    impairmentAccountId: contra[0] ?? null,
    totalAccumulatedMinor: (opening + state.recognized).toString(),
    carryingMinor: state.carrying.toString(),
    sourceSha256: state.source.sha256,
    reviewSha256: state.review.sha256,
  });
});
