import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Payroll from "@open-erp/contracts/payroll-calculations";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Db from "../../db/payroll/inputs";
import * as ClaimDb from "../../db/payroll/employee-claims";
import type { PostingOwner } from "../posting-admission";
import * as Foundation from "../../db/payroll-foundation";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import type { VerifiedPrincipal } from "../identity";
import {
  decode,
  requireRetainedEvidence,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
} from "../commerce/support";
import { failure } from "../failures";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  prepareJournalInTransaction,
  digest,
  isoNow,
  newId,
  replay,
  saveCommand,
} from "../posting";
import { compileInput } from "./input-basis";
import {
  requireManagedVariableInput,
  requireManagedVariableApproval,
  requireManagedVariableApprovalActor,
} from "./variable-pay";
import { economicKey } from "../purchases/recognition";
import * as Match from "effect/Match";

export const releaseExpiredReservations = Effect.fn("payroll.releaseExpiredReservations")(
  function* (tx: Transaction, scope: Scope) {
    for (const row of yield* Db.readExpiredReservations(tx, scope.bookId))
      yield* Db.insertReservationRelease(tx, scope.bookId, row.approvalId, row.runId);
  },
);

const requireInputAccess = Effect.fn("payroll.inputAccess")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  write: boolean,
) {
  if ((yield* Foundation.readPayrollAccess(tx, scope.bookId, actorId)).length !== 1)
    return yield* failure("Forbidden");
  yield* requireTableAccess(tx, Db.inputTables, write);

  if (write) yield* releaseExpiredReservations(tx, scope);
});

export const checkedInput = Effect.fn("payroll.checkedInput")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
) {
  const row = (yield* Db.readInput(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const submitted = yield* decode(Inputs.PayrollInput, row.body);
  const body = Object.fromEntries(Object.entries(row.body).filter(([field]) => field !== "digest"));

  if (
    submitted.scope.entityId !== scope.entityId ||
    submitted.scope.bookId !== scope.bookId ||
    submitted.id !== id ||
    (expectedDigest !== undefined && submitted.digest !== expectedDigest) ||
    (yield* digest(body)) !== submitted.digest
  )
    return yield* failure("StaleDependency");
  yield* requireRetainedEvidence(tx, scope.bookId, submitted.input.evidence);

  return submitted;
});

const requireUnmanagedClaimSource = Effect.fn("payroll.unmanagedClaimSource")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Inputs.SubmitPayrollInput.Type,
) {
  if (
    input.basis.kind === "claim" &&
    (yield* ClaimDb.sourceControl(
      tx,
      scope.bookId,
      input.basis.counterpartyId,
      input.basis.supplierDocumentNumber,
    )).length
  )
    return yield* failure("ApprovalRequired");
});

export const submitInput = Effect.fn("payroll.submitInput")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof Inputs.SubmitPayrollInput.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireInputAccess(tx, command.scope, principal.actorId, true);
      const operation = "submit_payroll_input";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        Inputs.PayrollInput,
      );

      if (request.previous) return request.previous;
      yield* requireUnmanagedClaimSource(tx, command.scope, command.input);
      yield* requireRetainedEvidence(tx, command.scope.bookId, command.input.evidence);
      const book = (yield* Ledger.readBook(tx, command.scope))[0];

      if (
        !book ||
        book.profile !== "synthetic-core-v1" ||
        book.currency !== "SEK" ||
        book.currencyScale !== 2 ||
        command.input.postingDate.slice(0, 7) !== command.input.month
      )
        return yield* failure("UnsupportedProfile");

      if ((yield* Db.readEconomicKey(tx, command.scope.bookId, command.input.economicKey)).length)
        return yield* failure("AlreadyPosted");

      if (
        !(yield* Foundation.listRevisions(tx, command.scope.bookId, command.input.employeeId))
          .length
      )
        return yield* failure("NotFound");

      const body = {
        id: newId("payroll_input"),
        scope: command.scope,
        input: command.input,
        createdAt: yield* isoNow(tx),
        createdBy: principal.actorId,
        receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
      };

      const result = yield* decode(
        Inputs.PayrollInput,
        yield* toJsonObject({ ...body, digest: yield* digest(body) }),
      );

      yield* Db.insertInput(tx, result);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

const recognition = Effect.fn("payroll.inputRecognition")(function* (
  tx: Transaction,
  scope: Scope,
  inputId: string,
) {
  for (const row of yield* Db.readExecutions(tx, scope.bookId, inputId)) {
    const execution = yield* decode(Inputs.PayrollInputExecution, row.body);

    if (execution.kind === "recognition") {
      const reviewRow = (yield* Db.readReview(tx, scope.bookId, execution.reviewId))[0];

      if (!reviewRow) return yield* failure("InternalError");

      return { execution, review: yield* decode(Inputs.PayrollInputReview, reviewRow.body) };
    }
  }

  return null;
});

const capacity = Effect.fn("payroll.inputCapacity")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: typeof Inputs.PayrollInput.Type,
) {
  const recognized = yield* recognition(tx, scope, submitted.id);
  const allocations = yield* Db.readAllocations(tx, scope.bookId, submitted.id);
  const paid = allocations.reduce((sum, row) => sum + BigInt(row.amount), 0n);

  return {
    recognized,
    residual: recognized
      ? (BigInt(recognized.review.outputs.reimbursementMinor) - paid).toString()
      : "0",
    digest: yield* digest({ recognitionId: recognized?.execution.id ?? null, allocations }),
  };
});

const holidayBalances = Effect.fn("payroll.inputHolidayBalances")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: typeof Inputs.PayrollInput.Type,
) {
  const basis = submitted.input.basis;

  if (basis.kind !== "variable") return { money: "0", social: "0" };

  return {
    money:
      (yield* Db.readCreditBalance(tx, scope.bookId, basis.holidayLiabilityAccountId))[0]?.minor ??
      "0",
    social:
      (yield* Db.readCreditBalance(tx, scope.bookId, basis.socialProvisionAccountId))[0]?.minor ??
      "0",
  };
});

export const checkedReview = Effect.fn("payroll.checkedInputReview")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
  current = false,
  claimReviewId?: string,
) {
  const row = (yield* Db.readReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* decode(Inputs.PayrollInputReview, row.body);
  const control = (yield* ClaimDb.inputControl(tx, scope.bookId, review.inputId))[0];

  if (control && control.id !== claimReviewId) return yield* failure("ApprovalRequired");

  if (
    review.scope.entityId !== scope.entityId ||
    review.id !== id ||
    (expectedDigest !== undefined && review.digest !== expectedDigest) ||
    (yield* digest(
      Object.fromEntries(Object.entries(row.body).filter(([field]) => field !== "digest")),
    )) !== review.digest
  )
    return yield* failure("StaleDependency");
  const submitted = yield* checkedInput(tx, scope, review.inputId, review.inputDigest);

  if (claimReviewId === undefined) yield* requireUnmanagedClaimSource(tx, scope, submitted.input);

  if (!current) return review;
  yield* requireManagedVariableInput(tx, scope, submitted);

  if ((yield* Db.readReviewExecution(tx, scope.bookId, review.id)).length)
    return yield* failure("AlreadyPosted");
  const balance = yield* capacity(tx, scope, submitted);

  if (balance.digest !== review.capacityDigest) return yield* failure("StaleDependency");

  if (review.kind === "direct_payment") {
    if (
      (yield* Db.readReservation(tx, scope.bookId, submitted.id)).length ||
      (yield* Db.readConsumption(tx, scope.bookId, submitted.id)).length
    )
      return yield* failure("AlreadyPosted");

    if (
      !review.payment ||
      !balance.recognized ||
      BigInt(review.payment.amountMinor) <= 0n ||
      BigInt(review.payment.amountMinor) > BigInt(balance.residual)
    )
      return yield* failure("InvalidJournal");
    yield* requireRetainedEvidence(tx, scope.bookId, review.payment.evidence);
  } else {
    yield* requireUnrecognizedInput(tx, scope, submitted, review.componentKeys, balance);
    const controls = yield* holidayBalances(tx, scope, submitted);

    if (
      controls.money !== review.currentHolidayMoneyMinor ||
      controls.social !== review.currentHolidaySocialMinor
    )
      return yield* failure("StaleDependency");
    const compiled = yield* compileInput(submitted, controls.money, controls.social);

    if (
      !equalJson(compiled.outputs, review.outputs) ||
      !equalJson(compiled.componentKeys, review.componentKeys)
    )
      return yield* failure("StaleDependency");
  }

  return review;
});

const requireUnrecognizedInput = Effect.fn("payroll.requireUnrecognizedInput")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: typeof Inputs.PayrollInput.Type,
  keys: ReadonlyArray<string>,
  balance: Effect.Success<ReturnType<typeof capacity>>,
) {
  if (new Set(keys).size !== keys.length) return yield* failure("InvalidJournal");

  if (balance.recognized || (yield* Db.readComponents(tx, scope.bookId, keys)).length)
    return yield* failure("AlreadyPosted");
  const basis = submitted.input.basis;

  if (
    basis.kind === "claim" &&
    (yield* Db.readPurchaseConflict(
      tx,
      scope.bookId,
      economicKey(basis.counterpartyId, basis.supplierDocumentNumber),
    ))[0]?.present
  )
    return yield* failure("AlreadyPosted");
});

const requireDirectCapacity = Effect.fn("payroll.requireDirectCapacity")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: typeof Inputs.PayrollInput.Type,
  payment: typeof Inputs.DirectPayrollInputPayment.Type,
  balance: Effect.Success<ReturnType<typeof capacity>>,
) {
  if (
    submitted.input.basis.kind !== "claim" ||
    (yield* Db.readReservation(tx, scope.bookId, submitted.id)).length ||
    (yield* Db.readConsumption(tx, scope.bookId, submitted.id)).length
  )
    return yield* failure("AlreadyPosted");

  if (
    !balance.recognized ||
    BigInt(payment.amountMinor) <= 0n ||
    BigInt(payment.amountMinor) > BigInt(balance.residual)
  )
    return yield* failure("InvalidJournal");
  yield* requireRetainedEvidence(tx, scope.bookId, payment.evidence);
});

export const prepareInputReviewInTransaction = Effect.fn("payroll.prepareInputReview")(function* (
  tx: Transaction,
  scope: Scope,
  principal: VerifiedPrincipal,
  idempotencyKey: string,
  submitted: typeof Inputs.PayrollInput.Type,
  payment: typeof Inputs.DirectPayrollInputPayment.Type | null,
) {
  yield* requireManagedVariableInput(tx, scope, submitted);
  const balance = yield* capacity(tx, scope, submitted);
  const controls = yield* holidayBalances(tx, scope, submitted);

  if (payment) yield* requireDirectCapacity(tx, scope, submitted, payment, balance);
  const compiled = payment ? null : yield* compileInput(submitted, controls.money, controls.social);

  if (compiled)
    yield* requireUnrecognizedInput(tx, scope, submitted, compiled.componentKeys, balance);
  const id = newId("payroll_input_review");
  const operation = payment ? "prepare_payroll_input_payment" : "review_payroll_input";
  const input = submitted.input;

  const journal = payment
    ? [
        {
          accountId: input.liabilityAccountId,
          debitMinor: payment.amountMinor,
          creditMinor: "0",
          description: "Employee claim direct cash allocation",
        },
        {
          accountId: payment.bankAccountId,
          debitMinor: "0",
          creditMinor: payment.amountMinor,
          description: "Synthetic employee claim cash payment",
        },
      ]
    : compiled?.journal;

  if (!journal) return yield* failure("InternalError");

  const postingPlan = yield* prepareJournalInTransaction(tx, principal, {
    scope,
    idempotencyKey: `${id}_prepare`,
    input: {
      kind: "manual_journal",
      evidenceId: payment?.evidence.evidenceId ?? input.evidence.evidenceId,
      eventKey: id,
      accountingPeriodId: payment?.accountingPeriodId ?? input.accountingPeriodId,
      postingDate: payment?.postingDate ?? input.postingDate,
      series: payment?.series ?? input.series,
      description: payment
        ? "Employee claim direct payment"
        : "Payroll input entitlement recognition",
      rationale: input.purpose,
      taxAssessment: "not_applicable",
      lines: journal,
    },
  });

  const outputs = compiled?.outputs ?? balance.recognized?.review.outputs;

  if (!outputs) return yield* failure("InternalError");

  const body = {
    id,
    scope,
    inputId: submitted.id,
    inputDigest: submitted.digest,
    kind: payment ? "direct_payment" : "recognition",
    outputs,
    componentKeys: compiled?.componentKeys ?? [],
    capacityDigest: balance.digest,
    payment,
    currentHolidayMoneyMinor: controls.money,
    currentHolidaySocialMinor: controls.social,
    postingPlan,
    createdBy: principal.actorId,
    createdAt: yield* isoNow(tx),
    receipt: { key: idempotencyKey, operation, actorId: principal.actorId },
  };

  const result = yield* decode(
    Inputs.PayrollInputReview,
    yield* toJsonObject({ ...body, digest: yield* digest(body) }),
  );

  const action = postingPlan.groups[0]?.actions[0];

  if (!action) return yield* failure("InternalError");
  yield* Db.insertReview(tx, result, action.eventId);

  return result;
});

export const reviewInput = Effect.fn("payroll.reviewInput")(function* (
  token: string,
  command: {
    scope: Scope;
    inputId: string;
    idempotencyKey: string;
    input: typeof Inputs.ReviewPayrollInput.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireInputAccess(tx, command.scope, principal.actorId, true);
      const operation = "review_payroll_input";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { inputId: command.inputId, input: command.input },
        Inputs.PayrollInputReview,
      );

      if (request.previous) return request.previous;

      const submitted = yield* checkedInput(
        tx,
        command.scope,
        command.inputId,
        command.input.inputDigest,
      );

      yield* requireUnmanagedClaimSource(tx, command.scope, submitted.input);

      if ((yield* ClaimDb.inputControl(tx, command.scope.bookId, submitted.id)).length)
        return yield* failure("ApprovalRequired");

      const result = yield* prepareInputReviewInTransaction(
        tx,
        command.scope,
        principal,
        command.idempotencyKey,
        submitted,
        null,
      );

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const prepareDirectPayment = Effect.fn("payroll.prepareInputPayment")(function* (
  token: string,
  command: {
    scope: Scope;
    inputId: string;
    idempotencyKey: string;
    input: typeof Inputs.DirectPayrollInputPayment.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireInputAccess(tx, command.scope, principal.actorId, true);
      const operation = "prepare_payroll_input_payment";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { inputId: command.inputId, input: command.input },
        Inputs.PayrollInputReview,
      );

      if (request.previous) return request.previous;

      const submitted = yield* checkedInput(
        tx,
        command.scope,
        command.inputId,
        command.input.inputDigest,
      );

      yield* requireUnmanagedClaimSource(tx, command.scope, submitted.input);

      if ((yield* ClaimDb.inputControl(tx, command.scope.bookId, submitted.id)).length)
        return yield* failure("ApprovalRequired");

      const result = yield* prepareInputReviewInTransaction(
        tx,
        command.scope,
        principal,
        command.idempotencyKey,
        submitted,
        command.input,
      );

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const approveInput = Effect.fn("payroll.approveInput")(function* (
  token: string,
  command: {
    scope: Scope;
    reviewId: string;
    idempotencyKey: string;
    input: typeof Inputs.ApprovePayrollInput.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireInputAccess(tx, command.scope, principal.actorId, true);
      const operation = "approve_payroll_input";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { reviewId: command.reviewId, input: command.input },
        Inputs.PayrollInputApproval,
      );

      if (request.previous) return request.previous;

      const review = yield* checkedReview(
        tx,
        command.scope,
        command.reviewId,
        command.input.reviewDigest,
        true,
      );

      yield* requireManagedVariableApproval(tx, command.scope, principal, review.inputId);

      const approval = yield* approveChangeInTransaction(tx, principal, {
        scope: command.scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `payinput_approve_${(yield* digest({ key: command.idempotencyKey })).slice(7)}`,
        owner: { kind: "payroll_input", id: review.id },
        input: { version: 1, planDigest: review.postingPlan.planDigest },
      });

      const result = yield* decode(Inputs.PayrollInputApproval, {
        id: approval.id,
        reviewId: review.id,
        reviewDigest: review.digest,
        actorId: approval.actorId,
        expiresAt: approval.expiresAt,
        receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
      });

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const executeInputInTransaction = Effect.fn("payroll.executeInputInTransaction")(function* (
  tx: Transaction,
  scope: Scope,
  principal: VerifiedPrincipal,
  review: typeof Inputs.PayrollInputReview.Type,
  approvalId: string,
  idempotencyKey: string,
  owner: PostingOwner,
) {
  const approval = (yield* Ledger.readApproval(tx, scope.bookId, approvalId))[0];

  if (
    !approval ||
    (yield* Foundation.readPayrollAccess(tx, scope.bookId, approval.actorId)).length !== 1
  )
    return yield* failure("ApprovalRequired");

  yield* requireManagedVariableApprovalActor(
    tx,
    scope,
    approval.actorId,
    review.inputId,
    approval.authorityBasis,
  );

  const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
    scope,
    changeSetId: review.postingPlan.id,
    idempotencyKey: `payinput_post_${(yield* digest({ key: idempotencyKey })).slice(7)}`,
    owner,
    input: { version: 1, planDigest: review.postingPlan.planDigest, approvalId },
  });

  const result = yield* decode(
    Inputs.PayrollInputExecution,
    yield* toJsonObject({
      id: newId("payroll_input_execution"),
      scope,
      inputId: review.inputId,
      reviewId: review.id,
      kind: review.kind,
      postingReceipt,
      createdAt: yield* isoNow(tx),
      receipt: {
        key: idempotencyKey,
        operation: "execute_payroll_input",
        actorId: principal.actorId,
      },
    }),
  );

  yield* Db.insertExecution(tx, result);

  if (review.kind === "recognition")
    for (const key of review.componentKeys)
      yield* Db.insertComponent(tx, scope.bookId, review.inputId, key);
  else if (review.payment)
    yield* Db.insertAllocation(
      tx,
      scope.bookId,
      review.inputId,
      result.id,
      review.payment.amountMinor,
    );

  return result;
});

export const executeInput = Effect.fn("payroll.executeInput")(function* (
  token: string,
  command: {
    scope: Scope;
    reviewId: string;
    idempotencyKey: string;
    input: typeof Inputs.ExecutePayrollInput.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      yield* requireInputAccess(tx, command.scope, principal.actorId, true);
      const operation = "execute_payroll_input";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { reviewId: command.reviewId, input: command.input },
        Inputs.PayrollInputExecution,
      );

      if (request.previous) return request.previous;

      const review = yield* checkedReview(
        tx,
        command.scope,
        command.reviewId,
        command.input.reviewDigest,
        true,
      );

      const result = yield* executeInputInTransaction(
        tx,
        command.scope,
        principal,
        review,
        command.input.approvalId,
        command.idempotencyKey,
        { kind: "payroll_input", id: review.id },
      );

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const snapshotInput = Effect.fn("payroll.snapshotInput")(function* (
  tx: Transaction,
  scope: Scope,
  inputId: string,
) {
  const submitted = yield* checkedInput(tx, scope, inputId);
  yield* requireManagedVariableInput(tx, scope, submitted, true);
  const balance = yield* capacity(tx, scope, submitted);

  if (!balance.recognized) return yield* failure("ApprovalRequired");

  const taxableLiabilityAccountId = Match.value(submitted.input.basis).pipe(
    Match.discriminator("kind")("mileage", (basis) => basis.taxableLiabilityAccountId),
    Match.discriminator("kind")("variable", () => submitted.input.liabilityAccountId),
    Match.discriminator("kind")("claim", () => null),
    Match.exhaustive,
  );

  return yield* decode(Inputs.PayrollInputSnapshot, {
    inputId,
    inputDigest: submitted.digest,
    reviewId: balance.recognized.review.id,
    executionId: balance.recognized.execution.id,
    employeeId: submitted.input.employeeId,
    month: submitted.input.month,
    evidence: submitted.input.evidence,
    reimbursementMinor: balance.residual,
    grossMinor: balance.recognized.review.outputs.grossMinor,
    grossRecognizedMinor: balance.recognized.review.outputs.grossRecognizedMinor,
    liabilityAccountId: submitted.input.liabilityAccountId,
    taxableLiabilityAccountId,
    capacityDigest: balance.digest,
  });
});

export const captureInputs = Effect.fn("payroll.captureInputs")(function* (
  tx: Transaction,
  scope: Scope,
  employeeId: string,
  month: string,
  ids: ReadonlyArray<string>,
  runId?: string,
) {
  yield* releaseExpiredReservations(tx, scope);
  const reservedMonth = yield* Db.readReservedApprovalMonth(tx, scope.bookId, employeeId, month);

  if (reservedMonth.some((row) => row.runId !== runId)) return yield* failure("AlreadyPosted");

  if (new Set(ids).size !== ids.length) return yield* failure("InvalidJournal");
  const snapshots = [];

  for (const id of ids) {
    if ((yield* Db.readConsumption(tx, scope.bookId, id)).length)
      return yield* failure("AlreadyPosted");
    const reserved = (yield* Db.readReservation(tx, scope.bookId, id))[0];

    if (reserved && reserved.runId !== runId) return yield* failure("AlreadyPosted");
    const snapshot = yield* snapshotInput(tx, scope, id);

    yield* requireUnmanagedClaimSource(tx, scope, (yield* checkedInput(tx, scope, id)).input);

    if ((yield* ClaimDb.inputControl(tx, scope.bookId, id)).length)
      return yield* failure("ApprovalRequired");

    if (snapshot.employeeId !== employeeId || snapshot.month !== month)
      return yield* failure("UnsupportedProfile");
    snapshots.push(snapshot);
  }

  return snapshots;
});

export const appendInputComponents = Effect.fn("payroll.appendInputComponents")(function* (
  input: typeof Payroll.PreparePayRun.Type,
  snapshots: ReadonlyArray<typeof Inputs.PayrollInputSnapshot.Type>,
) {
  if (snapshots.length > 0 && input.recordClass !== "synthetic")
    return yield* failure("UnsupportedProfile");

  const adjustments = [...input.work.adjustments];
  const reimbursements = [...input.work.reimbursements];

  const existingIds = [
    ...input.employment.grossAdjustments,
    ...input.work.adjustments,
    ...input.employment.reimbursements,
    ...input.work.reimbursements,
  ].map((row) => row.componentId);

  for (const row of snapshots) {
    if (existingIds.some((id) => id.startsWith(row.inputId)))
      return yield* failure("InvalidJournal");

    if (row.grossMinor !== "0")
      adjustments.push({
        componentId: `${row.inputId}_gross`,
        minor: row.grossMinor,
        description: "Approved retained payroll input cash entitlement",
        evidence: [row.evidence],
      });

    if (row.reimbursementMinor !== "0")
      reimbursements.push({
        componentId: `${row.inputId}_reimbursement`,
        minor: row.reimbursementMinor,
        description: "Approved existing employee liability transfer",
        evidence: row.evidence,
        treatment: "non_taxable_reimbursement",
      });
  }

  return { ...input, work: { ...input.work, adjustments, reimbursements } };
});

export const reserveInputs = Effect.fn("payroll.reserveInputs")(function* (
  tx: Transaction,
  scope: Scope,
  runId: string,
  snapshots: ReadonlyArray<typeof Inputs.PayrollInputSnapshot.Type>,
  approvalId: string,
) {
  for (const row of snapshots) {
    const reserved = (yield* Db.readReservation(tx, scope.bookId, row.inputId))[0];

    if (reserved && (reserved.runId !== runId || !equalJson(reserved.snapshot, row)))
      return yield* failure("AlreadyPosted");
    yield* Db.insertReservation(tx, scope.bookId, runId, row, approvalId);
  }
});

export const reserveMonth = Effect.fn("payroll.reserveApprovalMonth")(function* (
  tx: Transaction,
  scope: Scope,
  runId: string,
  approvalId: string,
  employeeId: string,
  month: string,
) {
  yield* Db.insertApprovalMonth(tx, scope.bookId, runId, approvalId, employeeId, month);
});

export const consumeInputs = Effect.fn("payroll.consumeInputs")(function* (
  tx: Transaction,
  scope: Scope,
  runId: string,
  snapshots: ReadonlyArray<typeof Inputs.PayrollInputSnapshot.Type>,
) {
  for (const row of snapshots) {
    const reserved = (yield* Db.readReservation(tx, scope.bookId, row.inputId))[0];

    if (!reserved || reserved.runId !== runId || !equalJson(reserved.snapshot, row))
      return yield* failure("StaleDependency");
    yield* Db.insertConsumption(tx, scope.bookId, runId, row);
  }
});

export const getInput = Effect.fn("payroll.getInput")(function* (
  token: string,
  command: { scope: Scope; inputId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* requireInputAccess(tx, command.scope, principal.actorId, false);
    const submitted = yield* checkedInput(tx, command.scope, command.inputId);
    const reviews = [];
    const executions = [];

    for (const row of yield* Db.readReviews(tx, command.scope.bookId, submitted.id))
      reviews.push(yield* decode(Inputs.PayrollInputReview, row.body));

    for (const row of yield* Db.readExecutions(tx, command.scope.bookId, submitted.id))
      executions.push(yield* decode(Inputs.PayrollInputExecution, row.body));

    return {
      submitted,
      reviews,
      executions,
      snapshot:
        executions.some((row) => row.kind === "recognition") &&
        !(yield* ClaimDb.inputControl(tx, command.scope.bookId, submitted.id)).length
          ? yield* snapshotInput(tx, command.scope, submitted.id)
          : null,
      reservedRunId:
        (yield* Db.readReservation(tx, command.scope.bookId, submitted.id))[0]?.runId ?? null,
      consumedRunId:
        (yield* Db.readConsumption(tx, command.scope.bookId, submitted.id))[0]?.runId ?? null,
    };
  });
});
