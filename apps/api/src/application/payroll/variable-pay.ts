import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as InputDb from "../../db/payroll/inputs";
import * as V from "@open-erp/contracts/variable-pay-review";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import * as Db from "../../db/payroll/variable-pay";
import * as Ledger from "../../db/posting";
import { readExecutionApprovalInTransaction } from "../posting";
import { readOnboardingResponsibility } from "../onboarding-policy";
import * as Foundation from "../../db/payroll-foundation";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Scope,
  type Principal,
} from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { checkedInput } from "./inputs";
import { assessVariableBasis, duplicateSources } from "./variable-pay-assessment";
import { readVariableSource, requireVariableSourceBinding } from "./variable-pay-source";
import { authorize, permits } from "../authority";

type Command<I> = { scope: Scope; idempotencyKey: string; input: I };

const access = Effect.fn("variablePay.access")(function* (
  tx: Transaction,
  scope: Scope,
  principal: Principal,
  write: boolean,
) {
  if ((yield* Foundation.readPayrollAccess(tx, scope.bookId, principal.actorId)).length !== 1)
    return yield* failure("Forbidden");

  if (write) yield* authorize(principal, "write_variable_pay_review");
  yield* requireTableAccess(tx, Db.variablePayTables, write);
});

const readAssessment = Effect.fn("variablePay.readAssessment")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
) {
  const row = (yield* Db.record(tx, scope.bookId, "payroll_input_assessments", id))[0];

  if (!row) return yield* failure("NotFound");
  const result = yield* decode(V.VariablePayAssessment, row.body);

  if (
    result.scope.entityId !== scope.entityId ||
    result.scope.bookId !== scope.bookId ||
    result.id !== id ||
    (expectedDigest !== undefined && result.digest !== expectedDigest) ||
    (yield* digest(
      Object.fromEntries(Object.entries(row.body).filter(([field]) => field !== "digest")),
    )) !== result.digest
  )
    return yield* failure("StaleDependency");

  return result;
});

const records = Effect.fn("variablePay.records")(function* (
  tx: Transaction,
  scope: Scope,
  inputId: string,
) {
  const selections = [];

  for (const row of yield* Db.related(
    tx,
    scope.bookId,
    "payroll_input_pending_selections",
    inputId,
  ))
    selections.push(yield* decode(V.VariablePayPendingSelection, row.body));
  const dispositions = [];

  for (const row of yield* Db.related(tx, scope.bookId, "payroll_input_dispositions", inputId))
    dispositions.push(yield* decode(V.VariablePayDisposition, row.body));

  if (selections.length > 100 || dispositions.length > 100)
    return yield* failure("UnsupportedProfile");

  return { selection: selections.at(-1) ?? null, dispositions };
});

const financialState = Effect.fn("variablePay.financialState")(function* (
  tx: Transaction,
  scope: Scope,
  inputId: string,
  qualified: boolean,
) {
  const reviewRows = yield* InputDb.readReviews(tx, scope.bookId, inputId);

  const executionRows = yield* InputDb.readExecutions(tx, scope.bookId, inputId);
  const executions = [];

  for (const row of executionRows)
    executions.push(yield* decode(Inputs.PayrollInputExecution, row.body));
  const recognition = executions.find((row) => row.kind === "recognition") ?? null;

  const latestReview = recognition
    ? (yield* InputDb.readReview(tx, scope.bookId, recognition.reviewId))[0]
    : reviewRows.at(-1);

  const financialReview = latestReview
    ? yield* decode(Inputs.PayrollInputReview, latestReview.body)
    : null;

  let financialApproval = null;

  if (financialReview) {
    const approval = (yield* Ledger.readApprovals(
      tx,
      scope.bookId,
      financialReview.postingPlan.id,
    ))[0];

    if (approval) {
      const currentApproval = yield* Effect.result(
        readExecutionApprovalInTransaction(
          tx,
          scope,
          {
            id: financialReview.postingPlan.id,
            planDigest: financialReview.postingPlan.planDigest,
          },
          approval.id,
        ),
      );

      const independent = Result.isSuccess(
        yield* Effect.result(
          requireManagedVariableApprovalActor(
            tx,
            scope,
            approval.actorId,
            inputId,
            approval.authorityBasis,
          ),
        ),
      );

      const payroll =
        (yield* Foundation.readPayrollAccess(tx, scope.bookId, approval.actorId)).length === 1;

      financialApproval = {
        id: approval.id,
        reviewId: financialReview.id,
        reviewDigest: financialReview.digest,
        actorId: approval.actorId,
        expiresAt: approval.expiresAt,
        usable:
          qualified &&
          recognition === null &&
          payroll &&
          independent &&
          Result.isSuccess(currentApproval),
      };
    }
  }

  return { financialReview, recognition, financialApproval };
});

export const variableReviewView = Effect.fn("variablePay.view")(function* (
  tx: Transaction,
  scope: Scope,
  assessment: typeof V.VariablePayAssessment.Type,
  principal?: Principal,
) {
  const submitted = yield* checkedInput(tx, scope, assessment.inputId, assessment.inputDigest);

  const ownRecognition = yield* recognizedReview(tx, scope, submitted.id);

  const checkedCurrent = yield* Effect.result(
    assessVariableBasis(tx, scope, submitted, assessment.sourceOccurrence, ownRecognition),
  );

  if (
    Result.isFailure(checkedCurrent) &&
    (!("code" in checkedCurrent.failure) ||
      ![
        "NotFound",
        "MissingEvidence",
        "UnsupportedProfile",
        "StaleDependency",
        "Unavailable",
      ].includes(checkedCurrent.failure.code))
  )
    return yield* checkedCurrent.failure;

  const current = Result.isSuccess(checkedCurrent)
    ? checkedCurrent.success
    : {
        ...assessment,
        dependencyDigest: "unavailable",
        blockers: [
          ...assessment.blockers,
          {
            code: "invalid_source" as const,
            sourceIds: [],
            dates: [],
            amountMinor: null,
            priorInputId: null,
            priorRunId: null,
            priorPaidEventId: null,
            priorPaidEventDigest: null,
            priorPaidEvidenceId: null,
            priorSettlementExecutionId: null,
            paidOn: null,
            priorRunRow: null,
          },
        ],
      };

  const state = yield* records(tx, scope, submitted.id);

  const terminal = state.dispositions
    .filter((row) => row.selectionId === state.selection?.id)
    .at(-1);

  const assessmentCurrent = current.dependencyDigest === assessment.dependencyDigest;

  const financial =
    (yield* Db.financialReferences(tx, scope.bookId, submitted.id))[0]?.present ?? true;

  const actionable =
    assessmentCurrent && !financial && state.selection?.assessmentId === assessment.id && !terminal;

  const { financialReview, recognition, financialApproval } = yield* financialState(
    tx,
    scope,
    submitted.id,
    assessmentCurrent && current.blockers.length === 0,
  );

  const disposable = actionable && financialReview === null;

  const responsibility = yield* readOnboardingResponsibility(tx, scope);

  const canApprove =
    actionable &&
    current.blockers.length === 0 &&
    principal !== undefined &&
    permits(principal, "approve_variable_input") &&
    principal.actorId !== submitted.createdBy &&
    principal.actorId !== assessment.createdBy &&
    (responsibility === undefined ||
      responsibility.assignments.bookkeepingApproverId === principal.actorId) &&
    financialApproval?.usable !== true;

  return yield* decode(
    V.VariablePayReviewView,
    yield* toJsonObject({
      assessment,
      financialReview:
        financialReview === null
          ? null
          : {
              id: financialReview.id,
              digest: financialReview.digest,
              postingPlanId: financialReview.postingPlan.id,
            },
      recognition:
        recognition === null
          ? null
          : {
              id: recognition.id,
              reviewId: recognition.reviewId,
              voucherId: recognition.postingReceipt.voucherId,
            },
      financialApproval,
      current: {
        assessmentCurrent,
        canPrepareFinancialReview: actionable && current.blockers.length === 0,
        canApprove,
        canReturn: disposable,
        canRemove: disposable,
        blockers: current.blockers,
        holidayControl: current.holidayControl,
        status: recognition
          ? "recognized"
          : (terminal?.kind ?? (current.blockers.length ? "blocked" : "ready")),
      },
      ...state,
    }),
  );
});

export const assessVariablePay = Effect.fn("variablePay.assess")(function* (
  token: string,
  command: Command<typeof V.AssessVariablePay.Type> & { inputId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* access(tx, command.scope, principal, true);
      const operation = "assess_variable_pay";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { inputId: command.inputId, input: command.input },
        V.VariablePayReviewView,
      );

      if (request.previous) return request.previous;

      const submitted = yield* checkedInput(
        tx,
        command.scope,
        command.inputId,
        command.input.inputDigest,
      );

      const basis = yield* assessVariableBasis(
        tx,
        command.scope,
        submitted,
        command.input.sourceOccurrence,
      );

      const body = {
        id: newId("variable_assessment"),
        scope: command.scope,
        inputId: submitted.id,
        inputDigest: submitted.digest,
        ...basis,
        createdAt: yield* isoNow(tx),
        createdBy: principal.actorId,
        receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
      };

      const assessment = yield* decode(
        V.VariablePayAssessment,
        yield* toJsonObject({ ...body, digest: yield* digest(body) }),
      );

      yield* Db.insert(
        tx,
        "payroll_input_assessments",
        assessment,
        yield* toJsonObject(assessment),
      );
      const result = yield* variableReviewView(tx, command.scope, assessment, principal);
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

export const selectVariablePay = Effect.fn("variablePay.select")(function* (
  token: string,
  command: Command<typeof V.SelectVariablePay.Type> & { assessmentId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* access(tx, command.scope, principal, true);
      const operation = "select_variable_pay";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { assessmentId: command.assessmentId, input: command.input },
        V.VariablePayReviewView,
      );

      if (request.previous) return request.previous;

      const assessment = yield* readAssessment(
        tx,
        command.scope,
        command.assessmentId,
        command.input.assessmentDigest,
      );

      const view = yield* variableReviewView(tx, command.scope, assessment, principal);

      if (!view.current.assessmentCurrent) return yield* failure("StaleDependency");

      if (view.selection) {
        if (
          view.selection.assessmentId === assessment.id ||
          view.dispositions.length ||
          view.financialReview !== null
        )
          return yield* failure("AlreadyPosted");
        const previous = yield* readAssessment(tx, command.scope, view.selection.assessmentId);
        const previousView = yield* variableReviewView(tx, command.scope, previous, principal);

        if (previousView.current.assessmentCurrent) return yield* failure("AlreadyPosted");
      }

      if ((yield* Db.financialReferences(tx, command.scope.bookId, assessment.inputId))[0]?.present)
        return yield* failure("AlreadyPosted");

      const body = {
        id: newId("variable_selection"),
        scope: command.scope,
        inputId: assessment.inputId,
        inputDigest: assessment.inputDigest,
        assessmentId: assessment.id,
        assessmentDigest: assessment.digest,
        createdAt: yield* isoNow(tx),
        createdBy: principal.actorId,
        receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
      };

      const selection = yield* decode(
        V.VariablePayPendingSelection,
        yield* toJsonObject({ ...body, digest: yield* digest(body) }),
      );

      yield* Db.insert(
        tx,
        "payroll_input_pending_selections",
        selection,
        yield* toJsonObject(selection),
      );
      const result = yield* variableReviewView(tx, command.scope, assessment, principal);
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

export const disposeVariablePay = Effect.fn("variablePay.dispose")(function* (
  token: string,
  command: Command<typeof V.DisposeVariablePay.Type> & { assessmentId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* access(tx, command.scope, principal, true);
      const operation = "dispose_variable_pay";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { assessmentId: command.assessmentId, input: command.input },
        V.VariablePayReviewView,
      );

      if (request.previous) return request.previous;

      const assessment = yield* readAssessment(
        tx,
        command.scope,
        command.assessmentId,
        command.input.assessmentDigest,
      );

      const view = yield* variableReviewView(tx, command.scope, assessment, principal);

      if (!view.current.assessmentCurrent) return yield* failure("StaleDependency");

      if (!view.current.canRemove || view.selection?.id !== command.input.selectionId)
        return yield* failure("AlreadyPosted");

      const body = {
        id: newId("variable_disposition"),
        scope: command.scope,
        inputId: assessment.inputId,
        inputDigest: assessment.inputDigest,
        assessmentId: assessment.id,
        assessmentDigest: assessment.digest,
        selectionId: command.input.selectionId,
        kind: command.input.kind,
        submitterActorId: assessment.submitter.actorId,
        createdAt: yield* isoNow(tx),
        createdBy: principal.actorId,
        receipt: { key: command.idempotencyKey, operation, actorId: principal.actorId },
      };

      const disposition = yield* decode(
        V.VariablePayDisposition,
        yield* toJsonObject({ ...body, digest: yield* digest(body) }),
      );

      yield* Db.insert(
        tx,
        "payroll_input_dispositions",
        disposition,
        yield* toJsonObject(disposition),
      );
      const result = yield* variableReviewView(tx, command.scope, assessment, principal);
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

export const getVariablePayAssessment = Effect.fn("variablePay.get")(function* (
  token: string,
  command: { scope: Scope; assessmentId: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* access(tx, command.scope, principal, false);

    return yield* variableReviewView(
      tx,
      command.scope,
      yield* readAssessment(tx, command.scope, command.assessmentId),
      principal,
    );
  });
});

export const listVariablePayAssessments = Effect.fn("variablePay.list")(function* (
  token: string,
  command: { scope: Scope; cursor?: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx, principal) {
    yield* access(tx, command.scope, principal, false);
    const rows = yield* Db.list(tx, command.scope.bookId, command.cursor ?? "", 50);
    const items = [];

    for (const row of rows.slice(0, 50))
      items.push(
        yield* variableReviewView(
          tx,
          command.scope,
          yield* decode(V.VariablePayAssessment, row.body),
          principal,
        ),
      );

    return { items, next: rows.length > 50 ? (items.at(-1)?.assessment.id ?? null) : null };
  });
});

export const requireManagedVariableInput = Effect.fn("variablePay.requireManaged")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: typeof Inputs.PayrollInput.Type,
  capture = false,
) {
  if (submitted.input.basis.kind !== "variable") return;
  const rows = yield* Db.related(tx, scope.bookId, "payroll_input_assessments", submitted.id);

  if (!rows.length) {
    const occurrence = (yield* Db.sourceForInput(
      tx,
      scope.bookId,
      submitted.input.evidence.sha256,
    ))[0];

    if (!occurrence) return yield* requireLegacyVariableOwnership(tx, scope, submitted);

    const source = yield* Effect.result(readVariableSource(tx, scope, occurrence.id));

    if (Result.isFailure(source)) return yield* source.failure;
    yield* requireVariableSourceBinding(submitted, source.success.profile);

    if ((yield* duplicateSources(tx, scope, submitted, source.success.profile)).length)
      return yield* failure("AlreadyPosted");

    return;
  }

  const row = rows.at(-1);

  if (!row) return yield* failure("InternalError");

  if (capture) {
    const state = yield* records(tx, scope, submitted.id);

    if (
      !state.selection ||
      state.dispositions.some((row) => row.selectionId === state.selection?.id)
    )
      return yield* failure("ApprovalRequired");

    const rows = yield* InputDb.readExecutions(tx, scope.bookId, submitted.id);
    let recognizedReview: typeof Inputs.PayrollInputReview.Type | null = null;

    for (const row of rows) {
      const execution = yield* decode(Inputs.PayrollInputExecution, row.body);

      if (execution.kind !== "recognition") continue;
      const record = (yield* InputDb.readReview(tx, scope.bookId, execution.reviewId))[0];

      if (!record) return yield* failure("InternalError");
      recognizedReview = yield* decode(Inputs.PayrollInputReview, record.body);
    }

    const basis = submitted.input.basis;

    if (!recognizedReview || basis.kind !== "variable") return yield* failure("ApprovalRequired");

    const money =
      (yield* InputDb.readCreditBalance(tx, scope.bookId, basis.holidayLiabilityAccountId))[0]
        ?.minor ?? "0";

    const social =
      (yield* InputDb.readCreditBalance(tx, scope.bookId, basis.socialProvisionAccountId))[0]
        ?.minor ?? "0";

    if (
      BigInt(money) !==
        BigInt(recognizedReview.currentHolidayMoneyMinor) +
          BigInt(recognizedReview.outputs.holidayMoneyDeltaMinor) ||
      BigInt(social) !==
        BigInt(recognizedReview.currentHolidaySocialMinor) +
          BigInt(recognizedReview.outputs.holidaySocialDeltaMinor)
    )
      return yield* failure("StaleDependency");

    return;
  }

  const view = yield* variableReviewView(
    tx,
    scope,
    yield* decode(V.VariablePayAssessment, row.body),
  );

  if (!view.current.assessmentCurrent) return yield* failure("StaleDependency");

  if (
    view.current.blockers.length ||
    view.selection?.assessmentId !== view.assessment.id ||
    view.dispositions.some((row) => row.selectionId === view.selection?.id)
  )
    return yield* failure("ApprovalRequired");
});

export const requireManagedVariableApproval = Effect.fn("variablePay.requireIndependentApproval")(
  function* (tx: Transaction, scope: Scope, principal: Principal, inputId: string) {
    const rows = yield* Db.related(tx, scope.bookId, "payroll_input_assessments", inputId);

    if (!rows.length) return;
    const latest = rows.at(-1);

    if (!latest) return yield* failure("InternalError");
    const assessment = yield* decode(V.VariablePayAssessment, latest.body);
    const input = yield* checkedInput(tx, scope, inputId, assessment.inputDigest);

    if (
      !permits(principal, "approve_variable_input") ||
      principal.actorId === input.createdBy ||
      principal.actorId === assessment.createdBy
    )
      return yield* failure("Forbidden");
  },
);

export const requireManagedVariableApprovalActor = Effect.fn(
  "variablePay.requireIndependentApprovalActor",
)(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  inputId: string,
  authorityBasis: Schema.JsonObject,
) {
  const rows = yield* Db.related(tx, scope.bookId, "payroll_input_assessments", inputId);
  const latest = rows.at(-1);

  if (!latest) return;
  const assessment = yield* decode(V.VariablePayAssessment, latest.body);
  const input = yield* checkedInput(tx, scope, inputId, assessment.inputDigest);
  const authentication = authorityBasis.authentication;

  if (
    typeof authentication !== "object" ||
    authentication === null ||
    !("kind" in authentication) ||
    (authentication.kind !== "betterAuthSession" && authentication.kind !== "apiCredential") ||
    !permits({ kind: authentication.kind }, "approve_variable_input")
  )
    return yield* failure("Forbidden");

  if (
    actorId === input.createdBy ||
    actorId === assessment.createdBy ||
    (yield* Db.submitter(tx, actorId)).length !== 1
  )
    return yield* failure("Forbidden");
});

const recognizedReview = Effect.fn("variablePay.recognizedReview")(function* (
  tx: Transaction,
  scope: Scope,
  inputId: string,
) {
  const state = yield* financialState(tx, scope, inputId, false);

  return state.recognition && state.financialReview?.id === state.recognition.reviewId
    ? state.financialReview
    : undefined;
});

const requireLegacyVariableOwnership = Effect.fn("variablePay.requireLegacyOwnership")(function* (
  tx: Transaction,
  scope: Scope,
  submitted: typeof Inputs.PayrollInput.Type,
) {
  if (submitted.input.basis.kind !== "variable") return;

  const prior = yield* Db.priorVariableInputs(
    tx,
    scope.bookId,
    submitted.input.employeeId,
    submitted.id,
  );

  if (prior.length > 100) return yield* failure("UnsupportedProfile");
  const dates = new Set(submitted.input.basis.work.map((row) => row.scheduleDate));

  for (const row of prior) {
    const original = yield* decode(Inputs.PayrollInput, row.body);

    if (
      original.input.basis.kind === "variable" &&
      original.input.basis.work.some((row) => dates.has(row.scheduleDate))
    )
      return yield* failure("AlreadyPosted");
  }
});
