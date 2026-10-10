import * as Claims from "@open-erp/contracts/employee-claims";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Effect from "effect/Effect";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Db from "../../db/payroll/employee-claims";
import * as InputDb from "../../db/payroll/inputs";
import * as Foundation from "../../db/payroll-foundation";
import * as Ledger from "../../db/posting";
import { readOnboardingResponsibility } from "../onboarding-policy";
import type { Transaction } from "../../db/transaction";
import type { VerifiedPrincipal } from "../identity";
import { decode, toJsonObject, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { approveChangeInTransaction } from "../posting";
import { newId } from "../identifiers";
import { replay, saveCommand } from "../command-receipts";
import {
  checkedReview,
  executeInputInTransaction,
  prepareInputReviewInTransaction,
} from "./inputs";
import * as Basis from "./employee-claim-basis";
import { authorize, permits } from "../authority";

type Command<I> = { scope: Scope; idempotencyKey: string; input: I };

const currentReviewState = Effect.fn("claims.currentReviewState")(function* (
  tx: Transaction,
  scope: Scope,
  revision: typeof Claims.EmployeeClaimRevision.Type,
  review: typeof Claims.EmployeeClaimReview.Type | undefined,
  completions: ReadonlyArray<typeof Claims.ClaimCompletionRequest.Type>,
) {
  if (!review || review.revisionId !== revision.id) return ["review_required"];

  if (
    completions.some(
      (entry) => entry.revisionId === revision.id && entry.createdAt >= review.createdAt,
    )
  )
    return ["completion_requested"];

  const employment = yield* Basis.employeeRevision(
    tx,
    scope,
    revision.input.employeeId,
    revision.input.month,
  );

  if (employment.id !== revision.employeeRevisionId) return ["employee_revision_changed"];

  const capture = yield* Basis.captureClaimSources(
    tx,
    scope,
    revision.input,
    revision.claimId,
  ).pipe(
    Effect.map((items) => (equalJson(items, review.items) ? [] : ["source_revision_changed"])),
    Effect.catchTag("AccountingError", (error) =>
      [
        "StaleDependency",
        "MissingEvidence",
        "UnsupportedProfile",
        "NotFound",
        "AlreadyPosted",
      ].includes(error.code)
        ? Effect.succeed(["source_qualification_changed"])
        : Effect.fail(error),
    ),
  );

  return capture;
});

const revisionRecord = Effect.fn("claims.revisionRecord")(function* (
  tx: Transaction,
  principal: VerifiedPrincipal,
  command: Command<typeof Claims.SubmitEmployeeClaim.Type>,
  claimId: string,
  previous: typeof Claims.EmployeeClaimRevision.Type | null,
) {
  const employment = yield* Basis.employeeRevision(
    tx,
    command.scope,
    command.input.employeeId,
    command.input.month,
  );

  const items = yield* Basis.captureClaimSources(tx, command.scope, command.input, claimId);

  const result = yield* Basis.sealClaimRecord(
    tx,
    command.scope,
    principal.actorId,
    command.idempotencyKey,
    previous ? "revise_employee_claim" : "submit_employee_claim",
    Claims.EmployeeClaimRevision,
    yield* toJsonObject({
      id: newId("claim_revision"),
      claimId,
      revision: (previous?.revision ?? 0) + 1,
      previousRevisionId: previous?.id ?? null,
      employeeRevisionId: employment.id,
      input: command.input,
      items,
    }),
  );

  yield* Basis.retainClaimRecord(tx, "employee_claim_revisions", result);

  return result;
});

export const submitEmployeeClaim = Effect.fn("claims.submit")(function* (
  token: string,
  command: Command<typeof Claims.SubmitEmployeeClaim.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      const operation = "submit_employee_claim";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        Claims.EmployeeClaimRevision,
      );

      if (request.previous) return request.previous;

      if ((yield* Db.claimKey(tx, command.scope.bookId, command.input.claimKey)).length)
        return yield* failure("AlreadyPosted");
      const claimId = newId("employee_claim");
      yield* Db.insertClaim(tx, command.scope.bookId, claimId, command.input);
      const result = yield* revisionRecord(tx, principal, command, claimId, null);
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

export const reviseEmployeeClaim = Effect.fn("claims.revise")(function* (
  token: string,
  command: Command<typeof Claims.ReviseEmployeeClaim.Type> & { claimId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      const operation = "revise_employee_claim";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { claimId: command.claimId, input: command.input },
        Claims.EmployeeClaimRevision,
      );

      if (request.previous) return request.previous;
      const current = yield* Basis.currentClaimRevision(tx, command.scope, command.claimId);

      if (current.digest !== command.input.expectedRevisionDigest)
        return yield* failure("StaleDependency");

      if (
        (yield* Db.records(
          tx,
          command.scope.bookId,
          "employee_claim_recognitions",
          command.claimId,
        )).length
      )
        return yield* failure("AlreadyPosted");

      if (
        current.input.claimKey !== command.input.claimKey ||
        current.input.employeeId !== command.input.employeeId ||
        current.input.month !== command.input.month
      )
        return yield* failure("UnsupportedProfile");
      const input = yield* decode(Claims.SubmitEmployeeClaim, yield* toJsonObject(command.input));

      const result = yield* revisionRecord(
        tx,
        principal,
        { ...command, input },
        command.claimId,
        current,
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

export const reviewEmployeeClaim = Effect.fn("claims.review")(function* (
  token: string,
  command: Command<typeof Claims.ReviewEmployeeClaim.Type> & { claimId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      const operation = "review_employee_claim";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { claimId: command.claimId, input: command.input },
        Claims.EmployeeClaimReview,
      );

      if (request.previous) return request.previous;
      const current = yield* Basis.currentClaimRevision(tx, command.scope, command.claimId);

      if (current.digest !== command.input.revisionDigest) return yield* failure("StaleDependency");

      if (
        (yield* Db.records(
          tx,
          command.scope.bookId,
          "employee_claim_recognitions",
          command.claimId,
        )).length
      )
        return yield* failure("AlreadyPosted");

      if (
        (yield* Basis.employeeRevision(
          tx,
          command.scope,
          current.input.employeeId,
          current.input.month,
        )).id !== current.employeeRevisionId
      )
        return yield* failure("StaleDependency");

      const items = yield* Basis.captureClaimSources(
        tx,
        command.scope,
        current.input,
        current.claimId,
      );

      if (!equalJson(items, current.items)) return yield* failure("StaleDependency");
      const id = newId("claim_review");

      const input = {
        ...(yield* Basis.claimInput(tx, command.scope, current, command.input, items)),
        economicKey: `claim:${command.claimId}:${id}`,
      };

      const preparedInput = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        "submit_payroll_input",
        Inputs.PayrollInput,
        yield* toJsonObject({ id: newId("payroll_input"), input }),
      );

      yield* InputDb.insertInput(tx, preparedInput);

      const preparedRecognition = yield* prepareInputReviewInTransaction(
        tx,
        command.scope,
        principal,
        command.idempotencyKey,
        preparedInput,
        null,
      );

      const qualified = items.find((item) => item.outcome === "qualified");
      const contribution = qualified?.assessment?.contribution;

      if (
        !contribution ||
        contribution.grossMinor !== preparedRecognition.outputs.reimbursementMinor
      )
        return yield* failure("StaleDependency");
      const direct = BigInt(command.input.directMinor);
      const liability = BigInt(contribution.grossMinor);

      if (direct < 0n || direct > liability) return yield* failure("InvalidJournal");

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.EmployeeClaimReview,
        yield* toJsonObject({
          id,
          claimId: command.claimId,
          revisionId: current.id,
          revisionDigest: current.digest,
          input: command.input,
          items,
          expenseMinor: contribution.expenseMinor,
          deductibleVatMinor: contribution.deductibleMinor,
          liabilityMinor: contribution.grossMinor,
          directMinor: direct.toString(),
          payrollMinor: (liability - direct).toString(),
          preparedInput,
          preparedRecognition,
        }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_reviews", result);
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

export const approveEmployeeClaim = Effect.fn("claims.approve")(function* (
  token: string,
  command: Command<typeof Claims.ApproveEmployeeClaim.Type> & { reviewId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      yield* authorize(principal, "approve_employee_claim");
      const operation = "approve_employee_claim";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { reviewId: command.reviewId, input: command.input },
        Claims.EmployeeClaimRecognition,
      );

      if (request.previous) return request.previous;

      const review = yield* Basis.readClaimRecord(
        tx,
        command.scope,
        "employee_claim_reviews",
        command.reviewId,
        Claims.EmployeeClaimReview,
      );

      if (review.digest !== command.input.reviewDigest) return yield* failure("StaleDependency");

      if (review.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

      if (
        (yield* Db.records(tx, command.scope.bookId, "employee_claim_recognitions", review.claimId))
          .length
      )
        return yield* failure("AlreadyPosted");

      const current = yield* Basis.currentClaimRevision(tx, command.scope, review.claimId);

      const reviews = yield* Basis.claimHistory(
        tx,
        command.scope,
        review.claimId,
        "employee_claim_reviews",
        Claims.EmployeeClaimReview,
      );

      const completions = yield* Basis.claimHistory(
        tx,
        command.scope,
        review.claimId,
        "employee_claim_completion_requests",
        Claims.ClaimCompletionRequest,
      );

      if (
        reviews.at(-1)?.id !== review.id ||
        (yield* currentReviewState(tx, command.scope, current, review, completions)).length
      )
        return yield* failure("StaleDependency");

      const canonical = yield* checkedReview(
        tx,
        command.scope,
        review.preparedRecognition.id,
        review.preparedRecognition.digest,
        true,
        review.id,
      );

      const owner = { kind: "employee_claim" as const, id: review.id };

      const approval = yield* approveChangeInTransaction(tx, principal, {
        scope: command.scope,
        changeSetId: canonical.postingPlan.id,
        idempotencyKey: `${review.id}_approve`,
        owner,
        input: { version: 1, planDigest: canonical.postingPlan.planDigest },
      });

      const inputExecution = yield* executeInputInTransaction(
        tx,
        command.scope,
        principal,
        canonical,
        approval.id,
        `${review.id}_execute`,
        owner,
      );

      const id = newId("claim_recognition");

      const makeInstruction = function* (kind: "direct" | "payroll", amountMinor: string) {
        if (BigInt(amountMinor) === 0n) return null;

        const instruction = yield* Basis.sealClaimRecord(
          tx,
          command.scope,
          principal.actorId,
          command.idempotencyKey,
          operation,
          Claims.ClaimInstruction,
          yield* toJsonObject({
            id: newId("claim_instruction"),
            claimId: review.claimId,
            recognitionId: id,
            kind,
            parentInputId: review.preparedInput.id,
            parentExecutionId: inputExecution.id,
            employeeId: current.input.employeeId,
            employeeRevisionId: current.employeeRevisionId,
            month: current.input.month,
            amountMinor,
            liabilityAccountId: review.preparedInput.input.liabilityAccountId,
            evidence: review.preparedInput.input.evidence,
          }),
        );

        yield* Basis.retainClaimRecord(tx, "employee_claim_instructions", instruction);

        return instruction;
      };

      const directInstruction = yield* Effect.gen(() =>
        makeInstruction("direct", review.directMinor),
      );

      const payrollInstruction = yield* Effect.gen(() =>
        makeInstruction("payroll", review.payrollMinor),
      );

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.EmployeeClaimRecognition,
        yield* toJsonObject({
          id,
          claimId: review.claimId,
          reviewId: review.id,
          reviewDigest: review.digest,
          approvalId: approval.id,
          inputExecution,
          postingReceipt: inputExecution.postingReceipt,
          directInstruction,
          payrollInstruction,
        }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_recognitions", result);
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

export const requestClaimCompletion = Effect.fn("claims.completion")(function* (
  token: string,
  command: Command<typeof Claims.RequestClaimCompletion.Type> & { claimId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      yield* authorize(principal, "request_claim_completion");
      const operation = "request_claim_completion";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { claimId: command.claimId, input: command.input },
        Claims.ClaimCompletionRequest,
      );

      if (request.previous) return request.previous;
      const current = yield* Basis.currentClaimRevision(tx, command.scope, command.claimId);

      if (current.digest !== command.input.revisionDigest) return yield* failure("StaleDependency");

      if (
        (yield* Db.records(
          tx,
          command.scope.bookId,
          "employee_claim_recognitions",
          command.claimId,
        )).length
      )
        return yield* failure("AlreadyPosted");

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.ClaimCompletionRequest,
        yield* toJsonObject({
          id: newId("claim_completion"),
          claimId: command.claimId,
          revisionId: current.id,
          input: command.input,
        }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_completion_requests", result);
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

const instructionState = Effect.fn("claims.instructionState")(function* (
  tx: Transaction,
  scope: Scope,
  instruction: typeof Claims.ClaimInstruction.Type,
) {
  const paymentPreviews = [],
    paymentExports = [],
    settlementReviews = [],
    settlements = [];

  for (const row of yield* Db.instructionRecords(
    tx,
    scope.bookId,
    "employee_claim_payment_previews",
    instruction.id,
  ))
    paymentPreviews.push(yield* decode(Claims.ClaimPaymentPreview, row.body));

  for (const row of yield* Db.instructionRecords(
    tx,
    scope.bookId,
    "employee_claim_payment_exports",
    instruction.id,
  ))
    paymentExports.push(yield* decode(Claims.ClaimPaymentExport, row.body));

  for (const row of yield* Db.instructionRecords(
    tx,
    scope.bookId,
    "employee_claim_settlement_reviews",
    instruction.id,
  ))
    settlementReviews.push(yield* decode(Claims.ClaimSettlementReview, row.body));

  for (const row of yield* Db.instructionRecords(
    tx,
    scope.bookId,
    "employee_claim_settlements",
    instruction.id,
  ))
    settlements.push(yield* decode(Claims.ClaimSettlement, row.body));

  if (
    [paymentPreviews, paymentExports, settlementReviews, settlements].some(
      (rows) => rows.length > 50,
    )
  )
    return yield* failure("UnsupportedProfile");

  const reservedRunId =
    (yield* Db.readReservation(tx, scope.bookId, instruction.id))[0]?.runId ?? null;

  const consumedRunId =
    (yield* Db.readConsumption(tx, scope.bookId, instruction.id))[0]?.runId ?? null;

  let status = "ready";

  if (reservedRunId) status = "reserved";

  if (paymentExports.length) status = "exported_unknown";

  if (consumedRunId) status = "consumed";

  if (settlements.length) status = "settled";

  return {
    instruction,
    paymentPreviews,
    paymentExports,
    settlementReviews,
    settlements,
    reservedRunId,
    consumedRunId,
    routeChangeAllowed: false,
    status,
  };
});

const readView = Effect.fn("claims.view")(function* (
  tx: Transaction,
  scope: Scope,
  claimId: string,
  principal: VerifiedPrincipal,
) {
  const revisions = yield* Basis.claimHistory(
    tx,
    scope,
    claimId,
    "employee_claim_revisions",
    Claims.EmployeeClaimRevision,
  );

  const current = revisions.at(-1);

  if (!current) return yield* failure("NotFound");

  const reviews = yield* Basis.claimHistory(
    tx,
    scope,
    claimId,
    "employee_claim_reviews",
    Claims.EmployeeClaimReview,
  );

  const completionRequests = yield* Basis.claimHistory(
    tx,
    scope,
    claimId,
    "employee_claim_completion_requests",
    Claims.ClaimCompletionRequest,
  );

  const recognition =
    (yield* Basis.claimHistory(
      tx,
      scope,
      claimId,
      "employee_claim_recognitions",
      Claims.EmployeeClaimRecognition,
    ))[0] ?? null;

  const instructions = [];

  for (const instruction of yield* Basis.claimHistory(
    tx,
    scope,
    claimId,
    "employee_claim_instructions",
    Claims.ClaimInstruction,
  ))
    instructions.push(yield* instructionState(tx, scope, instruction));

  const currentReview = reviews.at(-1)?.revisionId === current.id ? (reviews.at(-1) ?? null) : null;

  const reviewBlockers = recognition
    ? ["already_recognized"]
    : yield* currentReviewState(tx, scope, current, currentReview ?? undefined, completionRequests);

  const pendingReviewCurrent = reviewBlockers.length === 0;

  const humanOperator =
    permits(principal, "approve_employee_claim") &&
    (yield* Ledger.readOperatorMembership(tx, scope.bookId, principal.actorId)).length === 1;

  const responsibility = yield* readOnboardingResponsibility(tx, scope);

  if (responsibility && responsibility.assignments.bookkeepingApproverId !== principal.actorId)
    reviewBlockers.push("bookkeeping_approver_required");

  if (pendingReviewCurrent && currentReview?.createdBy === principal.actorId)
    reviewBlockers.push("independent_approver_required");

  if (!humanOperator) reviewBlockers.push("human_approver_required");

  const employment = (yield* Foundation.listRevisions(
    tx,
    scope.bookId,
    current.input.employeeId,
  )).find((row) => row.id === current.employeeRevisionId);

  if (!employment || typeof employment.body.personRef !== "string")
    return yield* failure("StaleDependency");

  return yield* decode(
    Claims.EmployeeClaimView,
    yield* toJsonObject({
      claimId,
      employeeName: employment.body.personRef,
      currentRevision: current.revision,
      current,
      currentReview,
      approvalAllowed: pendingReviewCurrent && reviewBlockers.length === 0,
      completionAllowed: humanOperator && recognition === null,
      reviewBlockers,
      revisions,
      reviews,
      completionRequests,
      recognition,
      instructions,
      pendingReviewCurrent,
    }),
  );
});

export const getEmployeeClaim = Effect.fn("claims.get")(function* (
  token: string,
  command: { scope: Scope; claimId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, false);

    return yield* readView(tx, command.scope, command.claimId, principal);
  });
});

export const listEmployeeClaims = Effect.fn("claims.list")(function* (
  token: string,
  command: { scope: Scope; after?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, false);
    const roots = yield* Db.roots(tx, command.scope.bookId, command.after ?? "");
    const claims = [];

    for (const root of roots.slice(0, 25))
      claims.push(yield* readView(tx, command.scope, root.id, principal));

    return yield* decode(
      Claims.EmployeeClaimDirectory,
      yield* toJsonObject({
        scope: command.scope,
        claims,
        pageSize: 25,
        next: roots.length > 25 ? (roots[24]?.id ?? null) : null,
      }),
    );
  });
});
