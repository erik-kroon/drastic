import * as Claims from "@open-erp/contracts/employee-claims";
import { swedishBusinessDate } from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Db from "../../db/payroll/employee-claims";
import * as Ledger from "../../db/posting";
import { admitHumanActor } from "../../db/human-actor";
import type { Transaction } from "../../db/transaction";
import { toJsonObject, withBook, requireRetainedEvidence, type Scope } from "../commerce/support";
import { failure } from "../failures";
import {
  approveChangeInTransaction,
  executeChangeInTransaction,
  prepareJournalInTransaction,
  newId,
  replay,
  saveCommand,
  digest,
  sha256Hex,
} from "../posting";
import { requireOnboardingResponsibility } from "../onboarding-policy";
import { transferDocument } from "../purchases/payment-document";
import { checkIban, checkBic, checkXmlText } from "../purchases/payments";
import { captureCash } from "./settlement-basis";
import { addMatch } from "../banking/matches";
import * as Basis from "./employee-claim-basis";

type Command<I> = { scope: Scope; idempotencyKey: string; input: I };

const checkAccount = Effect.fn("claims.checkPayeeAccount")(function* (
  name: string,
  iban: string,
  bic: string,
) {
  yield* Effect.try({
    try: () => {
      checkXmlText(name);
      checkIban(iban);
      checkBic(bic);
    },
    catch: () => failure("InvalidJournal"),
  });
});

const currentPayee = Effect.fn("claims.currentPayee")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const payee = yield* Basis.readClaimRecord(
    tx,
    scope,
    "employee_claim_payee_verifications",
    id,
    Claims.EmployeePayeeVerification,
  );

  yield* requireRetainedEvidence(tx, scope.bookId, payee.proposal.input.evidence);
  yield* requireRetainedEvidence(tx, scope.bookId, payee.input.evidence);

  const employment = yield* Basis.employeeRevision(
    tx,
    scope,
    payee.proposal.input.employeeId,
    "9999-12",
  );

  if (employment.id !== payee.proposal.input.employeeRevisionId)
    return yield* failure("StaleDependency");

  return payee;
});

const availableDirect = Effect.fn("claims.availableDirect")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expectedDigest?: string,
) {
  const instruction = yield* Basis.checkedInstruction(tx, scope, id, expectedDigest);

  if (instruction.kind !== "direct") return yield* failure("UnsupportedProfile");

  if ((yield* Db.instructionRecords(tx, scope.bookId, "employee_claim_settlements", id)).length)
    return yield* failure("AlreadyPosted");

  return instruction;
});

export const proposeEmployeePayee = Effect.fn("claims.proposePayee")(function* (
  token: string,
  command: Command<typeof Claims.ProposeEmployeePayee.Type>,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      const operation = "propose_employee_payee";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        Claims.EmployeePayeeProposal,
      );

      if (request.previous) return request.previous;

      if (
        (yield* Basis.employeeRevision(tx, command.scope, command.input.employeeId, "9999-12"))
          .id !== command.input.employeeRevisionId
      )
        return yield* failure("StaleDependency");
      yield* requireRetainedEvidence(tx, command.scope.bookId, command.input.evidence);
      yield* checkAccount(
        command.input.creditorName,
        command.input.creditorIban,
        command.input.creditorBic,
      );

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.EmployeePayeeProposal,
        yield* toJsonObject({ id: newId("employee_payee"), input: command.input }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_payee_proposals", result);
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

export const verifyEmployeePayee = Effect.fn("claims.verifyPayee")(function* (
  token: string,
  command: Command<typeof Claims.VerifyEmployeePayee.Type> & { id: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      yield* admitHumanActor(tx, token);
      const operation = "verify_employee_payee";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { id: command.id, input: command.input },
        Claims.EmployeePayeeVerification,
      );

      if (request.previous) return request.previous;

      const proposal = yield* Basis.readClaimRecord(
        tx,
        command.scope,
        "employee_claim_payee_proposals",
        command.id,
        Claims.EmployeePayeeProposal,
      );

      if (proposal.digest !== command.input.proposalDigest)
        return yield* failure("StaleDependency");

      if (proposal.createdBy === principal.actorId) return yield* failure("ApprovalRequired");
      yield* requireOnboardingResponsibility(
        tx,
        command.scope,
        principal.actorId,
        "paymentApproverId",
      );
      yield* requireRetainedEvidence(tx, command.scope.bookId, proposal.input.evidence);
      yield* requireRetainedEvidence(tx, command.scope.bookId, command.input.evidence);

      if (
        (yield* Basis.employeeRevision(tx, command.scope, proposal.input.employeeId, "9999-12"))
          .id !== proposal.input.employeeRevisionId
      )
        return yield* failure("StaleDependency");

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.EmployeePayeeVerification,
        yield* toJsonObject({
          id: newId("employee_payee_verification"),
          proposal,
          input: command.input,
          bankVerified: false,
        }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_payee_verifications", result);
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

export const prepareClaimPaymentFile = Effect.fn("claims.preparePaymentFile")(function* (
  token: string,
  command: Command<typeof Claims.PrepareClaimPaymentFile.Type> & { instructionId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      const operation = "prepare_claim_payment_file";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { instructionId: command.instructionId, input: command.input },
        Claims.ClaimPaymentPreview,
      );

      if (request.previous) return request.previous;

      const instruction = yield* availableDirect(
        tx,
        command.scope,
        command.instructionId,
        command.input.instructionDigest,
      );

      if (
        (yield* Db.instructionRecords(
          tx,
          command.scope.bookId,
          "employee_claim_payment_exports",
          instruction.id,
        )).length
      )
        return yield* failure("AlreadyPosted");

      if (
        (yield* Db.instructionRecords(
          tx,
          command.scope.bookId,
          "employee_claim_payment_previews",
          instruction.id,
        )).length >= 50
      )
        return yield* failure("UnsupportedProfile");
      const payee = yield* currentPayee(tx, command.scope, command.input.payeeVerificationId);

      if (
        payee.proposal.input.employeeId !== instruction.employeeId ||
        payee.proposal.input.employeeRevisionId !== instruction.employeeRevisionId
      )
        return yield* failure("StaleDependency");
      const today = swedishBusinessDate(new Date((yield* Ledger.readDatabaseTime(tx)).now));

      if (command.input.executionDate < today) return yield* failure("InvalidJournal");
      yield* checkAccount(
        command.input.debtorName,
        command.input.debtorIban,
        command.input.debtorBic,
      );

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.ClaimPaymentPreview,
        yield* toJsonObject({
          id: newId("claim_payment_preview"),
          instruction,
          payee,
          input: command.input,
          amountMinor: instruction.amountMinor,
          status: "preview",
          paid: false,
        }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_payment_previews", result);
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

export const approveClaimPaymentFile = Effect.fn("claims.approvePaymentFile")(function* (
  token: string,
  command: Command<typeof Claims.ApproveClaimPaymentFile.Type> & { id: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      yield* admitHumanActor(tx, token);
      const operation = "approve_claim_payment_file";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { id: command.id, input: command.input },
        Claims.ClaimPaymentExport,
      );

      if (request.previous) return request.previous;
      yield* requireOnboardingResponsibility(
        tx,
        command.scope,
        principal.actorId,
        "paymentApproverId",
      );

      const preview = yield* Basis.readClaimRecord(
        tx,
        command.scope,
        "employee_claim_payment_previews",
        command.id,
        Claims.ClaimPaymentPreview,
      );

      if (preview.digest !== command.input.previewDigest) return yield* failure("StaleDependency");

      if (preview.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

      const instruction = yield* availableDirect(
        tx,
        command.scope,
        preview.instruction.id,
        preview.instruction.digest,
      );

      if (
        (yield* Db.instructionRecords(
          tx,
          command.scope.bookId,
          "employee_claim_payment_exports",
          instruction.id,
        )).length
      )
        return yield* failure("AlreadyPosted");
      const payee = yield* currentPayee(tx, command.scope, preview.payee.id);

      if (payee.digest !== preview.payee.digest) return yield* failure("StaleDependency");

      if (
        preview.input.executionDate <
        swedishBusinessDate(new Date((yield* Ledger.readDatabaseTime(tx)).now))
      )
        return yield* failure("StaleDependency");

      const xml = transferDocument({
        id: preview.id,
        createdAt: preview.createdAt,
        input: preview.input,
        transfers: [
          {
            reference: instruction.id,
            remittance: instruction.claimId,
            amountMinor: instruction.amountMinor,
            creditorName: payee.proposal.input.creditorName,
            creditorIban: payee.proposal.input.creditorIban,
            creditorBic: payee.proposal.input.creditorBic,
          },
        ],
      });

      const bytes = new TextEncoder().encode(xml);
      const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.ClaimPaymentExport,
        yield* toJsonObject({
          id: newId("claim_payment_export"),
          previewId: preview.id,
          instructionId: instruction.id,
          previewDigest: preview.digest,
          amountMinor: instruction.amountMinor,
          format: "pain.001.001.03",
          mediaType: "application/xml",
          sha256: yield* sha256Hex(xml),
          base64,
          exposure: "unknown",
          paid: false,
          bankCompatible: false,
          bankAccepted: false,
        }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_payment_exports", result);
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

const bankConfirmation = Effect.fn("claims.bankConfirmation")(function* (
  tx: Transaction,
  scope: Scope,
  instruction: typeof Claims.ClaimInstruction.Type,
  exported: typeof Claims.ClaimPaymentExport.Type,
  cash: Effect.Success<ReturnType<typeof captureCash>>,
  evidence: typeof Claims.SettleClaimInstruction.Type.payeeEvidence,
) {
  const preview = yield* Basis.readClaimRecord(
    tx,
    scope,
    "employee_claim_payment_previews",
    exported.previewId,
    Claims.ClaimPaymentPreview,
  );

  const payee = yield* Basis.readClaimRecord(
    tx,
    scope,
    "employee_claim_payee_verifications",
    preview.payee.id,
    Claims.EmployeePayeeVerification,
  );

  if (
    preview.digest !== exported.previewDigest ||
    preview.instruction.digest !== instruction.digest ||
    preview.amountMinor !== instruction.amountMinor ||
    payee.digest !== preview.payee.digest ||
    cash.observedOn < preview.input.executionDate ||
    cash.observedOn < swedishBusinessDate(new Date(exported.createdAt))
  )
    return yield* failure("StaleDependency");
  yield* requireRetainedEvidence(tx, scope.bookId, evidence);
  const source = (yield* Ledger.readEvidence(tx, scope.bookId, evidence.evidenceId))[0];

  if (!source || source.mediaType !== "application/json")
    return yield* failure("UnsupportedProfile");

  const confirmation = yield* Schema.decodeEffect(
    Schema.fromJsonString(Claims.SyntheticClaimBankConfirmation),
  )(source.content).pipe(Effect.mapError(() => failure("UnsupportedProfile")));

  const expected = {
    profile: "synthetic_employee_claim_bank_confirmation_v1",
    recordClass: "synthetic",
    scope,
    statementId: cash.statementId,
    rowOrdinal: cash.rowOrdinal,
    bankAccountId: cash.accountId,
    bankEvidence: cash.evidence,
    observedOn: cash.observedOn,
    amountMinor: instruction.amountMinor,
    instructionId: instruction.id,
    instructionDigest: instruction.digest,
    exportId: exported.id,
    exportDigest: exported.digest,
    exportSha256: exported.sha256,
    previewId: preview.id,
    previewDigest: preview.digest,
    payeeVerificationId: payee.id,
    payeeVerificationDigest: payee.digest,
    creditorIban: payee.proposal.input.creditorIban,
  };

  if (!equalJson(confirmation, expected)) return yield* failure("StaleDependency");

  return confirmation;
});

const settlementBasis = Effect.fn("claims.settlementBasis")(function* (
  tx: Transaction,
  scope: Scope,
  instructionId: string,
  input: typeof Claims.SettleClaimInstruction.Type,
) {
  const instruction = yield* availableDirect(tx, scope, instructionId, input.instructionDigest);

  const exported = yield* Basis.readClaimRecord(
    tx,
    scope,
    "employee_claim_payment_exports",
    input.exportId,
    Claims.ClaimPaymentExport,
  );

  if (exported.instructionId !== instruction.id || exported.amountMinor !== instruction.amountMinor)
    return yield* failure("StaleDependency");
  const cash = yield* captureCash(tx, scope, input);

  if (BigInt(cash.amountMinor) !== -BigInt(instruction.amountMinor))
    return yield* failure("InvalidJournal");

  const confirmation = yield* bankConfirmation(
    tx,
    scope,
    instruction,
    exported,
    cash,
    input.payeeEvidence,
  );

  return {
    instruction,
    cash,
    confirmation,
    capacityDigest: yield* digest({
      instruction,
      exported,
      cash,
      confirmation,
      payeeEvidence: input.payeeEvidence,
    }),
  };
});

export const prepareClaimSettlement = Effect.fn("claims.prepareSettlement")(function* (
  token: string,
  command: Command<typeof Claims.SettleClaimInstruction.Type> & { instructionId: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      const operation = "prepare_claim_settlement";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { instructionId: command.instructionId, input: command.input },
        Claims.ClaimSettlementReview,
      );

      if (request.previous) return request.previous;

      if (
        (yield* Db.instructionRecords(
          tx,
          command.scope.bookId,
          "employee_claim_settlement_reviews",
          command.instructionId,
        )).length >= 50
      )
        return yield* failure("UnsupportedProfile");

      const captured = yield* settlementBasis(
        tx,
        command.scope,
        command.instructionId,
        command.input,
      );

      const id = newId("claim_settlement_review");

      const postingPlan = yield* prepareJournalInTransaction(tx, principal, {
        scope: command.scope,
        idempotencyKey: `${id}_prepare`,
        input: {
          kind: "manual_journal",
          eventKey: id,
          evidenceId: command.input.evidenceId,
          accountingPeriodId: command.input.accountingPeriodId,
          postingDate: command.input.postingDate,
          series: command.input.series,
          description: "Observed employee claim bank settlement",
          rationale: "Retained unused synthetic bank observation and independent payee evidence",
          taxAssessment: "not_applicable",
          lines: [
            {
              accountId: captured.instruction.liabilityAccountId,
              debitMinor: captured.instruction.amountMinor,
              creditMinor: "0",
              description: "Settle fixed employee claim debt",
            },
            {
              accountId: command.input.bankAccountId,
              debitMinor: "0",
              creditMinor: captured.instruction.amountMinor,
              description: "Observed employee claim bank payment",
            },
          ],
        },
      });

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.ClaimSettlementReview,
        yield* toJsonObject({
          id,
          instructionId: command.instructionId,
          input: command.input,
          capacityDigest: captured.capacityDigest,
          amountMinor: captured.instruction.amountMinor,
          confirmation: captured.confirmation,
          postingPlan,
        }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_settlement_reviews", result);
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

export const approveClaimSettlement = Effect.fn("claims.approveSettlement")(function* (
  token: string,
  command: Command<{ reviewDigest: string }> & { id: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* Basis.requireClaimsAccess(tx, command.scope, principal.actorId, true);
      yield* admitHumanActor(tx, token);
      const operation = "approve_claim_settlement";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { id: command.id, input: command.input },
        Claims.ClaimSettlement,
      );

      if (request.previous) return request.previous;

      const review = yield* Basis.readClaimRecord(
        tx,
        command.scope,
        "employee_claim_settlement_reviews",
        command.id,
        Claims.ClaimSettlementReview,
      );

      if (review.digest !== command.input.reviewDigest) return yield* failure("StaleDependency");

      if (review.createdBy === principal.actorId) return yield* failure("ApprovalRequired");

      const captured = yield* settlementBasis(
        tx,
        command.scope,
        review.instructionId,
        review.input,
      );

      if (captured.capacityDigest !== review.capacityDigest)
        return yield* failure("StaleDependency");
      const owner = { kind: "employee_claim_settlement" as const, id: review.id };

      const approval = yield* approveChangeInTransaction(tx, principal, {
        scope: command.scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `${review.id}_approve`,
        owner,
        input: { version: review.postingPlan.version, planDigest: review.postingPlan.planDigest },
      });

      const postingReceipt = yield* executeChangeInTransaction(tx, principal, {
        scope: command.scope,
        changeSetId: review.postingPlan.id,
        idempotencyKey: `${review.id}_execute`,
        owner,
        input: {
          version: review.postingPlan.version,
          planDigest: review.postingPlan.planDigest,
          approvalId: approval.id,
        },
      });

      const action = review.postingPlan.groups[0]?.actions[0];
      const bankLine = action?.lines.find((line) => line.accountId === review.input.bankAccountId);

      if (!bankLine) return yield* failure("InternalError");
      yield* addMatch(
        tx,
        command.scope.bookId,
        principal.actorId,
        {
          statementId: review.input.statementId,
          rowOrdinal: review.input.rowOrdinal,
          voucherId: postingReceipt.voucherId,
          lineId: bankLine.lineId,
        },
        "explicit",
      );

      const result = yield* Basis.sealClaimRecord(
        tx,
        command.scope,
        principal.actorId,
        command.idempotencyKey,
        operation,
        Claims.ClaimSettlement,
        yield* toJsonObject({
          id: newId("claim_settlement"),
          instructionId: review.instructionId,
          reviewId: review.id,
          approvalId: approval.id,
          postingReceipt,
        }),
      );

      yield* Basis.retainClaimRecord(tx, "employee_claim_settlements", result);
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
