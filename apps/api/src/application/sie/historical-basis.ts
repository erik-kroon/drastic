import * as Accounting from "@open-erp/contracts/accounting";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Effect from "effect/Effect";
import * as Db from "../../db/historical";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope, type Principal } from "../commerce/support";
import { failure } from "../failures";
import { createEvidenceInTransaction, prepareJournalInTransaction, executeChangeInTransaction,
  replay, saveCommand, isoNow, validatePlan } from "../posting";
import { readBasis, readPlan, requireStaged, mappedControls, sameBalances, type Identified, type Command } from "./historical-shared";

type Selection = typeof Historical.SelectBasis.Type;
const select = Effect.fn("historical.selectBasisInTransaction")(function* (tx: Transaction, principal: Principal, scope: Scope, input: Selection) {
  const year = (yield* Ledger.readFiscalYear(tx, scope.bookId, input.fiscalYearId))[0];
  if (!year) return yield* failure("NotFound");
  if (input.cutoverOn < year.startsOn || input.cutoverOn > year.endsOn) return yield* failure("InvalidJournal");
  const plan = yield* readPlan(tx, scope, input.sourcePlanId);
  if (plan.digest !== input.sourceDigest) return yield* failure("StaleDependency");
  yield* requireStaged(tx, scope, plan.id);
  const dates = yield* Db.readPostedDates(tx, scope.bookId);
  if ((yield* Db.readBasis(tx, scope.bookId, year.id)).length || dates.some((row) => input.mode === "opening_set" || row.postingDate >= year.startsOn))
    return yield* failure("AlreadyPosted");
  const ids = input.controls.map((row) => row.accountId);
  const accounts = yield* Ledger.readAccounts(tx, scope.bookId, ids);
  if (new Set(ids).size !== ids.length || accounts.length !== ids.length || accounts.some((row) => !row.active) ||
    input.controls.reduce((sum, row) => sum + BigInt(row.signedMinor), 0n) !== 0n)
    return yield* failure("InvalidJournal");
  if (input.mode === "full_history") {
    const expected = mappedControls(plan, "opening");
    if (input.changeSetId !== null || new Set(plan.input.openingControls.map((c) => c.year)).size !== 1 ||
      expected.size !== input.controls.length || !sameBalances(expected, new Map(input.controls.map((c) => [c.accountId, BigInt(c.signedMinor)]))))
      return yield* failure("InvalidJournal");
  } else {
    if (input.changeSetId === null || input.controls.every((c) => BigInt(c.signedMinor) <= 0n)) return yield* failure("ApprovalRequired");
    const row = (yield* Ledger.readChangeSet(tx, scope.bookId, input.changeSetId))[0];
    if (!row) return yield* failure("ApprovalRequired");
    const change = yield* decode(Accounting.ChangeSet, row.plan);
    yield* validatePlan(tx, scope, change);
    const action = change.groups[0]?.actions[0];
    if (!action || change.groups.length !== 1 || change.groups[0]?.actions.length !== 1 ||
      action.fiscalYearId !== year.id || action.postingDate !== input.cutoverOn || action.postingPurpose !== "adjustment" ||
      (yield* Ledger.readVoucherByChangeSet(tx, scope.bookId, change.id)).length || action.lines.length !== ids.length ||
      input.controls.some((c) => !action.lines.some((line) => line.accountId === c.accountId &&
        BigInt(line.debitMinor) === (BigInt(c.signedMinor) > 0n ? BigInt(c.signedMinor) : 0n) &&
        BigInt(line.creditMinor) === (BigInt(c.signedMinor) < 0n ? -BigInt(c.signedMinor) : 0n))))
      return yield* failure("InvalidJournal");
  }
  const basis = yield* decode(Historical.Basis, { ...input, actorId: principal.actorId, selectedAt: yield* isoNow(tx) });
  yield* Db.insertBasis(tx, scope.bookId, basis);
  return basis;
});

export const selectBasis = Effect.fn("historical.selectBasis")(function* (token: string, command: { scope: Scope; idempotencyKey: string; input: Selection }) {
  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    const operation = "select_historical_basis";
    const request = yield* replay(tx, command.scope, command.idempotencyKey, operation, principal.actorId, command.input, Historical.Basis);
    if (request.previous) return request.previous;
    const result = yield* select(tx, principal, command.scope, command.input);
    yield* saveCommand(tx, command.scope, command.idempotencyKey, request.expected, operation, principal.actorId, result);
    return result;
  }, "update");
});
export const getBasis = Effect.fn("historical.getBasis")(function* (token: string, command: Identified) {
  return yield* withBook(token, command.scope, false, function* (tx) { return yield* readBasis(tx, command.scope, command.id); });
});
export const listBases = Effect.fn("historical.listBases")(function* (token: string, command: { scope: Scope }) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const years = yield* Ledger.readAllFiscalYears(tx, command.scope.bookId);
    const result = [];
    for (const year of years) {
      const row = (yield* Db.readBasis(tx, command.scope.bookId, year.id))[0];
      result.push({ ...year, basis: row ? yield* decode(Historical.Basis, { ...row.body, voucherId: row.voucherId }) : null });
    }
    return yield* decode(Historical.BasisInventory, { scope: command.scope, years: result });
  });
});

const openingProposal = Effect.fn("historical.openingProposal")(function* (tx: Transaction, principal: Principal,
  command: { scope: Scope; idempotencyKey: string; input: typeof Historical.PrepareOpening.Type }) {
  const { input, scope, idempotencyKey } = command;
  const period = (yield* Ledger.readPeriod(tx, scope.bookId, input.accountingPeriodId))[0];
  if (!period || period.fiscalYearId !== input.fiscalYearId || input.controls.some((row) => BigInt(row.signedMinor) === 0n))
    return yield* failure("InvalidJournal");
  const evidence = yield* createEvidenceInTransaction(tx, principal, { scope, idempotencyKey: `${idempotencyKey}_evidence`, input: {
    title: "Reviewed historical opening", origin: "Independent opening controls and retained source plan", mediaType: "application/json", content: JSON.stringify(input) } });
  return yield* prepareJournalInTransaction(tx, principal, { scope, idempotencyKey: `${idempotencyKey}_journal`, input: {
    kind: "manual_journal", evidenceId: evidence.id, eventKey: `opening_${input.fiscalYearId}`, accountingPeriodId: period.id,
    postingDate: input.cutoverOn, series: input.series, description: "Reviewed historical opening", rationale: input.rationale,
    taxAssessment: "not_applicable", lines: input.controls.map((row) => {
      const amount = BigInt(row.signedMinor);
      return { accountId: row.accountId, debitMinor: (amount > 0n ? amount : 0n).toString(), creditMinor: (amount < 0n ? -amount : 0n).toString(), description: "Reviewed historical opening" };
    }) } });
});
export const prepareOpening = Effect.fn("historical.prepareOpening")(function* (token: string, command: { scope: Scope; idempotencyKey: string; input: typeof Historical.PrepareOpening.Type }) {
  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    const operation = "prepare_historical_opening";
    const request = yield* replay(tx, command.scope, command.idempotencyKey, operation, principal.actorId, command.input, Historical.OpeningPreparation);
    if (request.previous) return request.previous;
    const proposal = yield* openingProposal(tx, principal, command);
    const { accountingPeriodId: _period, series: _series, ...basisInput } = command.input;
    const basis = yield* select(tx, principal, command.scope, { ...basisInput, mode: "opening_set", changeSetId: proposal.id });
    const result = { basis, proposal };
    yield* saveCommand(tx, command.scope, command.idempotencyKey, request.expected, operation, principal.actorId, result);
    return result;
  }, "update");
});
export const refreshOpening = Effect.fn("historical.refreshOpening")(function* (token: string, command: Command & { input: typeof Historical.RefreshOpening.Type }) {
  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    const operation = "refresh_historical_opening";
    const request = yield* replay(tx, command.scope, command.idempotencyKey, operation, principal.actorId, { fiscalYearId: command.id, input: command.input }, Historical.OpeningPreparation);
    if (request.previous) return request.previous;
    const basis = yield* readBasis(tx, command.scope, command.id);
    if (basis.mode !== "opening_set" || basis.voucherId) return yield* failure("AlreadyPosted");
    if (basis.changeSetId === null || basis.changeSetId !== command.input.expectedChangeSetId) return yield* failure("StaleDependency");
    const proposal = yield* openingProposal(tx, principal, { ...command, input: { ...basis, ...command.input } });
    const updated = { ...basis, changeSetId: proposal.id };
    yield* Db.replaceOpening(tx, command.scope.bookId, basis.changeSetId, updated);
    const result = { basis: updated, proposal };
    yield* saveCommand(tx, command.scope, command.idempotencyKey, request.expected, operation, principal.actorId, result);
    return result;
  }, "update");
});
export const postOpening = Effect.fn("historical.postOpening")(function* (token: string, command: Command & { planDigest: string; approvalId: string }) {
  return yield* withBook(token, command.scope, true, function* (tx, principal) {
    const operation = "post_historical_opening";
    const payload = { fiscalYearId: command.id, planDigest: command.planDigest, approvalId: command.approvalId };
    const request = yield* replay(tx, command.scope, command.idempotencyKey, operation, principal.actorId, payload, Historical.Basis);
    if (request.previous) return request.previous;
    const basis = yield* readBasis(tx, command.scope, command.id);
    if (basis.mode !== "opening_set" || basis.changeSetId === null) return yield* failure("InvalidJournal");
    if (basis.voucherId) return yield* failure("AlreadyPosted");
    const receipt = yield* executeChangeInTransaction(tx, principal, { scope: command.scope, changeSetId: basis.changeSetId,
      idempotencyKey: `${command.idempotencyKey}_ledger`, input: { version: 1, planDigest: command.planDigest, approvalId: command.approvalId } });
    yield* Db.recordOpening(tx, command.scope.bookId, command.id, receipt.voucherId);
    const result = yield* decode(Historical.Basis, { ...basis, voucherId: receipt.voucherId, ledgerReceipt: receipt });
    yield* saveCommand(tx, command.scope, command.idempotencyKey, request.expected, operation, principal.actorId, result);
    return result;
  }, "update");
});
