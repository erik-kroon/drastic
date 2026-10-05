import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import * as Subledgers from "@open-erp/contracts/subledgers";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/subledger/occurrence-corrections";
import * as Schedules from "../../db/subledger/schedules";
import * as Posting from "../../db/posting";
import * as Admission from "../../db/posting-admission";
import type { Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { digest } from "../posting";
import { decode, type Scope } from "../commerce/support";
import { readOccurrenceStates, readPostingBasis } from "./schedules";

export function scheduleOccurrenceContribution(
  tx: Transaction,
  scope: Scope,
  original: typeof Accounting.Voucher.Type,
  intent: typeof Corrections.CorrectionIntent.Type,
) {
  return Effect.gen(function* () {
    const candidates = yield* Db.readOccurrenceForVoucher(tx, scope.bookId, original.id);

    if (candidates.length === 0) return undefined;

    const candidate = candidates[0];

    if (!candidate || candidates.length !== 1 || !intent.scheduleDecision)
      return yield* failure("UnsupportedProfile");

    const row = (yield* Schedules.readCurrentRevision(tx, scope.bookId, candidate.scheduleId))[0];

    if (!row) return yield* failure("StaleDependency");

    const revision = yield* decode(Subledgers.ScheduleRevision, row.body);

    const states = yield* readOccurrenceStates(tx, scope, revision, "9999-12-31");

    const selected = states.find((state) => state.ordinal === candidate.ordinal);

    const postingBasis = yield* readPostingBasis(tx, scope, revision);

    if (
      !selected ||
      selected.state !== "posted" ||
      !postingBasis.supported ||
      (selected.effectiveVoucherId ?? selected.voucherId) !== original.id
    )
      return yield* failure("UnsupportedProfile");

    const originalLines = original.action.lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
      description: line.description,
      originalDimensions: line.originalDimensions ?? [],
    }));

    const replacementLines = intent.replacement.lines.map((line) => ({
      accountId: line.accountId,
      debitMinor: line.debitMinor,
      creditMinor: line.creditMinor,
      description: line.description,
      originalDimensions: line.originalDimensions ?? [],
    }));

    if (
      !equalJson(originalLines, replacementLines) ||
      originalLines.length !== 2 ||
      originalLines[0]?.accountId !== revision.terms.debitAccountId ||
      originalLines[0]?.debitMinor !== selected.amountMinor ||
      originalLines[0]?.creditMinor !== "0" ||
      originalLines[1]?.accountId !== revision.terms.creditAccountId ||
      originalLines[1]?.creditMinor !== selected.amountMinor ||
      originalLines[1]?.debitMinor !== "0"
    )
      return yield* failure("UnsupportedProfile");

    const sources = yield* Admission.readOwnedSources(
      tx,
      scope.bookId,
      candidate.originalChangeSetId,
      original.action.eventId,
      original.action.evidenceRefs.map((reference) => reference.evidenceId),
    );

    if (sources.length !== 0) return yield* failure("UnsupportedProfile");

    const book = (yield* Posting.readBook(tx, scope))[0];

    if (!book || book.profile !== "synthetic-core-v1") return yield* failure("UnsupportedProfile");

    const remainingMinor = states
      .filter((state) => state.state === "unprepared" || state.state === "prepared")
      .reduce((total, state) => total + BigInt(state.amountMinor), 0n)
      .toString();

    const basisDigest = yield* digest({ revision, states, postingBasis, original });

    return {
      kind: "schedule_occurrence_replacement_v1",
      scheduleId: revision.scheduleId,
      scheduleName: revision.terms.name,
      ordinal: selected.ordinal,
      eventKey: selected.eventKey,
      originalVoucherId: candidate.originalVoucherId,
      predecessorVoucherId: original.id,
      scheduleDigest: revision.digest,
      amountMinor: selected.amountMinor,
      remainingMinor,
      remainingPlanDecision: intent.scheduleDecision,
      basisDigest,
    } satisfies typeof Corrections.ScheduleOccurrenceContribution.Type;
  });
}

export function admitScheduleCorrectionChild(
  tx: Transaction,
  scope: Scope,
  bundleId: string,
  changeId: string,
  action: Schema.JsonObject,
) {
  return Effect.gen(function* () {
    const row = (yield* Db.readOwner(tx, scope.bookId, bundleId))[0];

    if (!row) return yield* failure("ApprovalRequired");

    const contribution = yield* decode(Corrections.ScheduleOccurrenceContribution, row.body);

    const reversal = yield* decode(Accounting.ChangeSet, row.reversalPlan);

    const replacement = yield* decode(Accounting.ChangeSet, row.replacementPlan);

    const child = [reversal, replacement].find((plan) => plan.id === changeId);

    if (!child || !equalJson(child.groups[0]?.actions[0], action))
      return yield* failure("StaleDependency");

    return contribution;
  });
}

export function retainScheduleOccurrenceCorrection(
  tx: Transaction,
  scope: Scope,
  bundle: typeof Corrections.CorrectionBundle.Type,
  receipt: typeof Corrections.CorrectionBundleReceipt.Type,
) {
  return Effect.gen(function* () {
    const contribution = bundle.registerContribution;

    if (contribution?.kind !== "schedule_occurrence_replacement_v1") return;

    yield* Db.insertTransition(tx, {
      bookId: scope.bookId,
      bundleId: bundle.id,
      scheduleId: contribution.scheduleId,
      ordinal: contribution.ordinal,
      predecessor: contribution.predecessorVoucherId,
      reversal: receipt.reversal.voucherId,
      replacement: receipt.replacement.voucherId,
    });
  });
}
