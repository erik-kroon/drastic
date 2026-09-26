import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Effect from "effect/Effect";
import {
  decode,
  requireInsertAccess,
  requireText,
  withBook,
  type Scope,
} from "../commerce/support";
import { failure } from "../failures";
import { digest, isoNow, readBook, replay, saveCommand } from "../posting";
import * as Db from "../../db/posting";
import * as ControlsDb from "../../db/subledger/controls";
import * as SchedulesDb from "../../db/subledger/schedules";

export const recordBasis = Effect.fn("subledger.recordBasis")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    input: typeof Controls.RecordSubledgerBasis.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const { input, scope, idempotencyKey } = command;
      const operation = "record_subledger_basis";
      const request = yield* replay(
        transaction,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Controls.SubledgerBasis,
      );
      if (request.previous) return request.previous;
      yield* requireInsertAccess(transaction, [
        "subledger_bases",
        "subledger_basis_lines",
        "command_receipts",
      ]);
      const book = yield* readBook(transaction, scope);
      if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
        return yield* failure("UnsupportedProfile");
      yield* requireText(input.sourceLocator, 256);
      yield* requireText(input.rationale, 2000);
      const cost = BigInt(input.originalCostMinor);
      const accumulated = BigInt(input.accumulatedMinor);
      const carrying = BigInt(input.carryingMinor);
      if (
        carrying <= 0n ||
        cost !== accumulated + carrying ||
        (input.kind === "acquisition" && accumulated !== 0n) ||
        new Set(input.lineIds).size !== input.lineIds.length
      )
        return yield* failure("InvalidJournal");
      if ((yield* SchedulesDb.readScheduleInventory(transaction, scope.bookId)).length > 200)
        return yield* failure("UnsupportedProfile");
      const retained = (yield* SchedulesDb.readCurrentRevision(
        transaction,
        scope.bookId,
        input.scheduleId,
      ))[0];
      if (!retained) return yield* failure("NotFound");
      const schedule = yield* decode(Subledgers.ScheduleRevision, retained.body);
      if (input.expectedDigest !== schedule.digest) return yield* failure("StaleDependency");
      const first = schedule.occurrences[0];
      if (
        carrying !== BigInt(schedule.terms.costMinor) ||
        !first ||
        input.effectiveOn >= first.postingDate
      )
        return yield* failure("InvalidJournal");
      if (
        (yield* ControlsDb.readBasisConflicts(
          transaction,
          scope.bookId,
          input.scheduleId,
          input.evidenceId,
          input.sourceLocator,
        )).length > 0
      )
        return yield* failure("IdempotencyConflict");
      if ((yield* ControlsDb.listBases(transaction, scope.bookId)).length >= 200)
        return yield* failure("UnsupportedProfile");
      const source = (yield* Db.readEvidence(transaction, scope.bookId, input.evidenceId))[0];
      const review = (yield* Db.readEvidence(transaction, scope.bookId, input.reviewEvidenceId))[0];
      if (!source || !review) return yield* failure("MissingEvidence");
      const voucher = (yield* Db.readVoucher(transaction, scope.bookId, input.voucherId))[0];
      if (
        !voucher ||
        voucher.sequence > book.committedSequence ||
        voucher.postingDate !== input.effectiveOn
      )
        return yield* failure("MissingEvidence");
      const action = yield* decode(Accounting.VoucherPostingAction, voucher.action);
      if (
        !action.evidenceRefs.some(
          (ref) => ref.evidenceId === source.id && ref.sha256 === source.sha256,
        )
      )
        return yield* failure("MissingEvidence");
      const links = (yield* ControlsDb.readBasisVoucherLinks(
        transaction,
        scope.bookId,
        voucher.id,
      ))[0];
      if (
        voucher.correctsVoucherId !== null ||
        links?.prepared ||
        links?.occurrence ||
        (yield* Db.readVoucherByReversal(transaction, scope.bookId, voucher.id)).length > 0
      )
        return yield* failure("UnsupportedProfile");
      const lines = yield* ControlsDb.readBasisLines(
        transaction,
        scope.bookId,
        voucher.id,
        input.lineIds,
      );
      yield* validateLines(lines, input, schedule.terms.debitAccountId);
      const body = {
        scope,
        input,
        scheduleDigest: schedule.digest,
        sourceSha256: source.sha256,
        reviewSha256: review.sha256,
        voucherSequence: voucher.sequence.toString(),
        currency: book.currency,
        currencyScale: book.currencyScale,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          lineId: line.lineId,
          ordinal: line.ordinal,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
        })),
        coverage: "not_established" as const,
        legalPolicyApproved: false as const,
        createdAt: yield* isoNow(transaction),
        receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
      };
      const basis = yield* decode(Controls.SubledgerBasis, {
        ...body,
        digest: yield* digest(body),
      });
      yield* ControlsDb.insertBasis(
        transaction,
        scope.bookId,
        input.scheduleId,
        source.id,
        input.sourceLocator,
        voucher.id,
        basis,
      );
      yield* ControlsDb.insertBasisLines(
        transaction,
        scope.bookId,
        input.scheduleId,
        voucher.id,
        input.lineIds,
      );
      yield* saveCommand(
        transaction,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        basis,
      );
      return basis;
    },
    "update",
  );
});

function validateLines(
  lines: ReadonlyArray<ControlsDb.BasisLineRow>,
  input: typeof Controls.RecordSubledgerBasis.Type,
  debitAccountId: string,
) {
  if (lines.some((line) => line.assigned)) return failure("IdempotencyConflict");
  if (
    lines.length !== input.lineIds.length ||
    lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n) !==
      BigInt(input.originalCostMinor) ||
    lines.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n) !==
      BigInt(input.accumulatedMinor) ||
    lines.some((line) => line.accountId === debitAccountId)
  )
    return failure("InvalidJournal");
  return Effect.void;
}
