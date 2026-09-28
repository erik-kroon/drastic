import * as Assessment from "@open-erp/contracts/vat-assessment";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  compileRoundingBridge,
  expectedSettlementControl,
  prepareAssessment as compileAssessment,
  type AssessmentFailure,
} from "@open-erp/domain/vat-assessment";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import {
  approveChangeInTransaction,
  digest,
  executeChangeInTransaction,
  isoNow,
  newId,
  prepareJournalInTransaction,
  replay,
  saveCommand,
} from "../posting";
import * as Db from "../../db/vat/assessment";
import * as ActualDb from "../../db/vat/actual-return";
import * as TaxDb from "../../db/vat/tax-account";
import * as Ledger from "../../db/posting";
import { readTableAccess } from "../../db/commerce/access";
import type { Transaction } from "../../db/transaction";
import {
  commandReceipt,
  decode,
  readEvidenceReference,
  toJsonObject,
  unsupported,
  withBook,
  type Scope,
} from "../commerce/support";

type JsonObject = Schema.JsonObject;

const BridgeSchema = Assessment.VatRoundingBridge;

const BridgeApprovalSchema = Assessment.RoundingBridgeApproval;

const AssessmentSchema = Assessment.VatAssessment;

const AssessmentApprovalSchema = Assessment.AssessmentApproval;

type Bridge = typeof Assessment.VatRoundingBridge.Type;

const maximumApprovals = 50;

const approvalWindowMs = 60 * 60 * 1000;

function assessmentAccess(transaction: Transaction, inserts: ReadonlyArray<string>) {
  return readTableAccess(transaction, [...Db.assessmentTables]).pipe(
    Effect.flatMap((rows) => {
      const denied = Db.assessmentTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);

        return (
          access === undefined || !access.canSelect || (inserts.includes(name) && !access.canInsert)
        );
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function refusalFor(assessmentFailure: AssessmentFailure) {
  return assessmentFailure.code === "AlreadyApplied"
    ? failure("AlreadyPosted")
    : failure("InvalidJournal");
}

function readReturnRow(transaction: Transaction, scope: Scope, returnId: string) {
  return Db.readReturnBasis(transaction, scope.bookId, returnId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];

      return row ? Effect.succeed(row) : failure("NotFound");
    }),
  );
}

const AccountRolesSchema = Schema.Struct({
  basis: Schema.Struct({
    accountRoles: Schema.Array(Schema.Struct({ role: Schema.String, accountId: Schema.String })),
  }),
});

function settlementBinding(body: JsonObject) {
  return decode(AccountRolesSchema, body).pipe(
    Effect.map(
      (bindings) =>
        bindings.basis.accountRoles.find((binding) => binding.role === "vat_settlement_control")
          ?.accountId ?? null,
    ),
  );
}

function boundAccountIds(body: JsonObject) {
  return decode(AccountRolesSchema, body).pipe(
    Effect.map(
      (bindings) => new Set(bindings.basis.accountRoles.map((binding) => binding.accountId)),
    ),
  );
}

function verifyBridgeAccounts(
  transaction: Transaction,
  scope: Scope,
  bindings: Set<string>,
  settlementAccountId: string,
  gainAccountId: string,
  lossAccountId: string,
  settlementBindingId: string | null,
) {
  return Effect.gen(function* () {
    if (new Set([settlementAccountId, gainAccountId, lossAccountId]).size !== 3) {
      return yield* failure("InvalidJournal");
    }

    if (settlementBindingId !== null && settlementAccountId !== settlementBindingId) {
      return yield* failure("InvalidJournal");
    }

    for (const accountId of [settlementAccountId, gainAccountId, lossAccountId]) {
      const account = (yield* Db.readActiveAccount(transaction, scope.bookId, accountId))[0];

      if (account === undefined || account.id !== accountId) {
        return yield* failure("InvalidJournal");
      }
    }

    if (
      (yield* Db.readBankSourceConflict(transaction, scope.bookId, [
        settlementAccountId,
        gainAccountId,
        lossAccountId,
      ]))[0]?.present === true
    ) {
      return yield* failure("InvalidJournal");
    }

    // A rounding gain or loss account that is itself a VAT control would
    // corrupt the control reconciliation the bridge is measured against.
    if (bindings.has(gainAccountId) || bindings.has(lossAccountId)) {
      return yield* failure("InvalidJournal");
    }
  });
}

export const prepareRoundingBridge = Effect.fn("vat.assessment.prepareBridge")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Assessment.PrepareRoundingBridge.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* assessmentAccess(transaction, [...Db.assessmentInserts]);

    const book = (yield* Ledger.readBook(transaction, command.scope))[0];

    if (!book) return yield* failure("Forbidden");

    if (book.profile !== "synthetic-core-v1" || book.authority !== "native") {
      return yield* unsupported();
    }

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "prepare_rounding_bridge",
      principal.actorId,
      yield* toJsonObject(command.input),
      BridgeSchema,
    );

    if (request.previous) return request.previous;

    const basis = yield* readReturnRow(transaction, command.scope, command.input.returnId);

    const priorBridges = yield* Db.readBridgesForReturn(
      transaction,
      command.scope.bookId,
      basis.id,
    );

    const priorMinor = priorBridges
      .reduce((total, row) => total + BigInt(row.deltaMinor), 0n)
      .toString();

    // The reported figure is expressed in book minor units through the
    // return's own retained residual, so the lineage is exact at any filing
    // unit with no tolerance and no plug.
    const reportedScaledMinor = (
      BigInt(basis.exactNetMinor) - BigInt(basis.residualNetMinor)
    ).toString();

    const lineageMinor = (BigInt(basis.residualNetMinor) - BigInt(priorMinor)).toString();

    const bindings = yield* boundAccountIds(basis.body);
    const settlementBindingId = yield* settlementBinding(basis.body);

    yield* verifyBridgeAccounts(
      transaction,
      command.scope,
      bindings,
      command.input.settlementAccountId,
      command.input.gainAccountId,
      command.input.lossAccountId,
      settlementBindingId,
    );

    const evidence = yield* readEvidenceReference(
      transaction,
      command.scope.bookId,
      command.input.evidenceId,
    );

    const compiled = compileRoundingBridge({
      obligationId: basis.id,
      returnRevision: basis.digest,
      exactNetMinor: basis.exactNetMinor,
      reportedNetMinor: reportedScaledMinor,
      priorBridgeEffectsMinor: priorBridges.map((row) => row.deltaMinor),
      lineageExplainedMinor: lineageMinor,
      roundingReleaseId: basis.ruleReleaseId,
      settlementControlAccountId: command.input.settlementAccountId,
      roundingGainAccountId: command.input.gainAccountId,
      roundingLossAccountId: command.input.lossAccountId,
    });

    if (Result.isFailure(compiled)) return yield* refusalFor(compiled.failure);

    const bridgeId = newId("vat_bridge");
    const now = yield* isoNow(transaction);

    const body = {
      id: bridgeId,
      scope: command.scope,
      version: 1,
      returnId: basis.id,
      obligationId: basis.id,
      exactNetMinor: basis.exactNetMinor,
      reportedNetMinor: reportedScaledMinor,
      lineageMinor,
      priorMinor,
      roundingReleaseId: basis.ruleReleaseId,
      plan: compiled.success,
      settlementAccountId: command.input.settlementAccountId,
      gainAccountId: command.input.gainAccountId,
      lossAccountId: command.input.lossAccountId,
      voucherId: null,
      approvalId: null,
      evidence,
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, "prepare_rounding_bridge", principal.actorId),
    };

    const bridge = yield* decode(BridgeSchema, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertBridge(transaction, {
      bookId: command.scope.bookId,
      id: bridgeId,
      returnId: basis.id,
      deltaMinor: compiled.success.bridgeDeltaMinor,
      body: yield* toJsonObject(bridge),
      digest: bridge.digest,
      recordedAt: now,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "prepare_rounding_bridge",
      principal.actorId,
      yield* toJsonObject(bridge),
    );

    return bridge;
  });
});

function readBridgeRow(transaction: Transaction, scope: Scope, bridgeId: string) {
  return Db.readBridge(transaction, scope.bookId, bridgeId).pipe(
    Effect.flatMap((rows) => {
      const bridge = rows[0];

      return bridge ? Effect.succeed(bridge) : failure("NotFound");
    }),
  );
}

export const approveRoundingBridge = Effect.fn("vat.assessment.approveBridge")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly bridgeId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Assessment.ApproveRoundingBridge.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* assessmentAccess(transaction, [...Db.assessmentInserts]);

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "approve_rounding_bridge",
      principal.actorId,
      {
        bridgeId: command.bridgeId,
        input: yield* toJsonObject(command.input),
      },
      BridgeApprovalSchema,
    );

    if (request.previous) return request.previous;

    const bridgeRow = yield* readBridgeRow(transaction, command.scope, command.bridgeId);

    if (command.input.digest !== bridgeRow.body["digest"]) {
      return yield* failure("StaleDependency");
    }

    if (
      (yield* Db.readBridgeReceiptByBridge(
        transaction,
        command.scope.bookId,
        command.bridgeId,
      ))[0] !== undefined
    ) {
      return yield* failure("StaleDependency");
    }

    const ordinal =
      (yield* Db.readBridgeApprovalCount(transaction, command.scope.bookId, command.bridgeId))[0]!
        .total + 1;

    if (ordinal > maximumApprovals) return yield* failure("InvalidJournal");

    const now = yield* isoNow(transaction);

    const body = {
      id: newId("bridge_approval"),
      scope: command.scope,
      bridgeId: command.bridgeId,
      digest: command.input.digest,
      version: 1,
      actorId: principal.actorId,
      ordinal,
      expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, "approve_rounding_bridge", principal.actorId),
    };

    const approval = yield* decode(BridgeApprovalSchema, body);

    yield* Db.insertBridgeApproval(transaction, {
      bookId: command.scope.bookId,
      id: approval.id,
      bridgeId: command.bridgeId,
      ordinal,
      actorId: principal.actorId,
      digest: approval.digest,
      expiresAt: approval.expiresAt,
      body: yield* toJsonObject(approval),
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "approve_rounding_bridge",
      principal.actorId,
      yield* toJsonObject(approval),
    );

    return approval;
  });
});

export const executeRoundingBridge = Effect.fn("vat.assessment.executeBridge")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly bridgeId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Assessment.ExecuteRoundingBridge.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "execute_rounding_bridge";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      { bridgeId: command.bridgeId, input: yield* toJsonObject(command.input) },
      BridgeSchema,
    );

    if (request.previous) return request.previous;

    yield* assessmentAccess(transaction, [...Db.assessmentInserts]);

    const book = (yield* Ledger.readBook(transaction, command.scope))[0];

    if (!book) return yield* failure("Forbidden");

    const bridgeRow = yield* readBridgeRow(transaction, command.scope, command.bridgeId);
    const bridge: Bridge = yield* decode(BridgeSchema, bridgeRow.body);

    if (bridge.digest !== command.input.digest) return yield* failure("StaleDependency");

    if (
      (yield* Db.readBridgeReceiptByBridge(transaction, command.scope.bookId, bridge.id))[0] !==
      undefined
    ) {
      return yield* failure("StaleDependency");
    }

    const approval = (yield* Db.readBridgeApprovalById(
      transaction,
      command.scope.bookId,
      command.input.approvalId,
      bridge.id,
    ))[0];

    const now = yield* isoNow(transaction);

    if (
      approval === undefined ||
      approval.digest !== bridge.digest ||
      Date.parse(approval.expiresAt) <= Date.parse(now)
    ) {
      return yield* failure("ApprovalRequired");
    }

    if (approval.actorId === principal.actorId) {
      return yield* failure("ApprovalRequired");
    }

    // A bridge sealed earlier never posts on top of a concurrently executed
    // one: the live prior effects must still yield the sealed delta.
    const livePrior = (yield* Db.readBridgesForReturn(
      transaction,
      command.scope.bookId,
      bridge.returnId,
    )).filter((row) => row.id !== bridge.id);

    const liveDelta = (
      BigInt(bridge.exactNetMinor) -
      BigInt(bridge.reportedNetMinor) -
      livePrior.reduce((total, row) => total + BigInt(row.deltaMinor), 0n)
    ).toString();

    if (liveDelta !== bridge.plan.bridgeDeltaMinor) {
      return yield* failure("StaleDependency");
    }

    let voucherId: string | null = null;
    let changeSetId: string | null = null;

    if (bridge.plan.journal.length > 0) {
      const eventKey = `vat_bridge_${bridge.id}`;
      const evidenceId = bridge.evidence.evidenceId;

      const eventRows = yield* Ledger.readEvent(
        transaction,
        command.scope.bookId,
        evidenceId,
        eventKey,
      );

      const eventId =
        eventRows[0]?.id ??
        (yield* Ledger.insertEvent(
          transaction,
          command.scope.bookId,
          newId("event"),
          evidenceId,
          eventKey,
        ))[0]?.id;

      if (eventId === undefined) return yield* failure("InternalError");

      const periods = yield* TaxDb.readPeriodsForDate(
        transaction,
        command.scope.bookId,
        now.slice(0, 10),
      );

      const period = periods.find((entry) => !entry.locked);

      if (period === undefined) return yield* failure("InvalidJournal");

      const evidence = (yield* Ledger.readEvidence(
        transaction,
        command.scope.bookId,
        evidenceId,
      ))[0];

      if (evidence === undefined) return yield* failure("MissingEvidence");

      const plan = yield* prepareJournalInTransaction(transaction, principal, {
        scope: command.scope,
        idempotencyKey: newId("bridge_prepare"),
        input: {
          kind: "manual_journal",
          evidenceId,
          eventKey,
          accountingPeriodId: period.id,
          postingDate: now.slice(0, 10),
          series: "VAT",
          description: `Rounding bridge ${bridge.returnId}`,
          rationale: "Qualified rounding precision bridge",
          taxAssessment: "not_applicable",
          lines: bridge.plan.journal.map((line) => ({
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            description: line.description,
          })),
        },
      });

      const kernel = yield* approveChangeInTransaction(transaction, principal, {
        scope: command.scope,
        changeSetId: plan.id,
        idempotencyKey: newId("bridge_approve"),
        input: { version: 1, planDigest: plan.planDigest },
      });

      const postingReceipt = yield* executeChangeInTransaction(transaction, principal, {
        scope: command.scope,
        changeSetId: plan.id,
        idempotencyKey: newId("bridge_post"),
        input: { version: 1, planDigest: plan.planDigest, approvalId: kernel.id },
        owner: { kind: "vat_assessment", id: bridge.id },
      });

      voucherId = postingReceipt.voucherId;
      changeSetId = plan.id;
    }

    const receiptId = newId("bridge_receipt");

    const body = {
      id: receiptId,
      scope: command.scope,
      bridgeId: bridge.id,
      approvalId: approval.id,
      voucherId,
      changeSetId,
      deltaMinor: bridge.plan.bridgeDeltaMinor,
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
    };

    const receipt = {
      ...body,
      digest: yield* digest(body),
    };

    yield* Db.insertBridgeReceipt(transaction, {
      bookId: command.scope.bookId,
      id: receiptId,
      bridgeId: bridge.id,
      approvalId: approval.id,
      voucherId,
      changeSetId,
      body: yield* toJsonObject(receipt),
      digest: receipt.digest,
      recordedAt: now,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(receipt),
    );

    return yield* decode(BridgeSchema, bridgeRow.body);
  });
});

function readAssessmentRow(transaction: Transaction, scope: Scope, assessmentId: string) {
  return Db.readAssessment(transaction, scope.bookId, assessmentId).pipe(
    Effect.flatMap((rows) => {
      const assessment = rows[0];

      return assessment ? Effect.succeed(assessment) : failure("NotFound");
    }),
  );
}

export const prepareAssessment = Effect.fn("vat.assessment.prepareRecord")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Assessment.PrepareAssessment.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* assessmentAccess(transaction, [...Db.assessmentInserts]);

    const book = (yield* Ledger.readBook(transaction, command.scope))[0];

    if (!book) return yield* failure("Forbidden");

    if (book.profile !== "synthetic-core-v1" || book.authority !== "native") {
      return yield* unsupported();
    }

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "prepare_vat_assessment",
      principal.actorId,
      yield* toJsonObject(command.input),
      AssessmentSchema,
    );

    if (request.previous) return request.previous;

    const basis = yield* readReturnRow(transaction, command.scope, command.input.returnId);

    if (
      (yield* Db.readAssessmentByIdentity(
        transaction,
        command.scope.bookId,
        command.input.assessmentIdentity,
      ))[0] !== undefined
    ) {
      return yield* failure("AlreadyPosted");
    }

    const event = (yield* TaxDb.readEvent(
      transaction,
      command.scope.bookId,
      command.input.taxAccountEventId,
    ))[0];

    if (event === undefined) return yield* failure("NotFound");

    const confirmationEvidence = yield* readEvidenceReference(
      transaction,
      command.scope.bookId,
      command.input.confirmations.confirmationEvidenceId,
    );

    void confirmationEvidence;

    const settlementBindingId = yield* settlementBinding(basis.body);

    if (settlementBindingId === null || command.input.settlementAccountId !== settlementBindingId) {
      return yield* failure("InvalidJournal");
    }

    for (const accountId of [
      command.input.settlementAccountId,
      command.input.taxAccountControlId,
    ]) {
      const account = (yield* Db.readActiveAccount(
        transaction,
        command.scope.bookId,
        accountId,
      ))[0];

      if (account === undefined || account.id !== accountId) {
        return yield* failure("InvalidJournal");
      }
    }

    if (command.input.settlementAccountId === command.input.taxAccountControlId) {
      return yield* failure("InvalidJournal");
    }

    if (
      (yield* Db.readBankSourceConflict(transaction, command.scope.bookId, [
        command.input.settlementAccountId,
        command.input.taxAccountControlId,
      ]))[0]?.present === true
    ) {
      return yield* failure("InvalidJournal");
    }

    let existingPosting = null;

    if (command.input.adoptedVoucherId !== null || command.input.adoptedMatchId !== null) {
      if (command.input.adoptedVoucherId === null || command.input.adoptedMatchId === null) {
        return yield* failure("InvalidJournal");
      }

      const match = (yield* TaxDb.readMatch(
        transaction,
        command.scope.bookId,
        command.input.adoptedMatchId,
      ))[0];

      if (
        match === undefined ||
        match.eventId !== event.id ||
        match.voucherId !== command.input.adoptedVoucherId
      ) {
        return yield* failure("InvalidJournal");
      }

      // Old manual journals are adopted only through explicit reviewed role
      // evidence: the voucher's settlement and tax-account vectors must equal
      // the assessed charge exactly, and the match relationship must be
      // unused. Equal amounts alone never prove the relationship.
      const lines = yield* Db.readVoucherLines(transaction, command.scope.bookId, match.voucherId);
      const signedByAccount = new Map<string, bigint>();

      for (const line of lines) {
        const signed = BigInt(line.debitMinor) - BigInt(line.creditMinor);
        signedByAccount.set(line.accountId, (signedByAccount.get(line.accountId) ?? 0n) + signed);
      }

      const assessed = BigInt(command.input.assessedMinor);

      if (
        lines.length !== 2 ||
        signedByAccount.get(command.input.settlementAccountId) !== assessed ||
        signedByAccount.get(command.input.taxAccountControlId) !== -assessed
      ) {
        return yield* failure("InvalidJournal");
      }

      if (
        (yield* Db.readAssessmentByMatch(transaction, command.scope.bookId, match.id))[0]
          ?.present === true
      ) {
        return yield* failure("InvalidJournal");
      }

      existingPosting = {
        settlementMinor: assessed.toString(),
        taxAccountMinor: (-assessed).toString(),
        matchRef: match.id,
        relationshipUsed: false,
      };
    }

    const knownIdentities = (yield* Db.readAssessmentsForReturn(
      transaction,
      command.scope.bookId,
      basis.id,
    )).map((row) => row.assessmentIdentity);

    const compiled = compileAssessment({
      assessmentIdentity: command.input.assessmentIdentity,
      obligationId: basis.id,
      authorityPeriod: command.input.authorityPeriod,
      assessedMinor: command.input.assessedMinor,
      expectedRemainingMinor: command.input.expectedRemainingMinor,
      knownAssessmentIdentities: knownIdentities,
      existingPosting,
      settlementControlAccountId: command.input.settlementAccountId,
      taxAccountControlId: command.input.taxAccountControlId,
    });

    if (Result.isFailure(compiled)) return yield* refusalFor(compiled.failure);

    const assessmentId = newId("vat_assessment");
    const now = yield* isoNow(transaction);

    const evidence = yield* readEvidenceReference(
      transaction,
      command.scope.bookId,
      command.input.confirmations.confirmationEvidenceId,
    );

    const body = {
      id: assessmentId,
      scope: command.scope,
      version: 1,
      assessmentIdentity: command.input.assessmentIdentity,
      obligationId: basis.id,
      returnId: basis.id,
      authorityPeriod: command.input.authorityPeriod,
      plan: compiled.success,
      assessedMinor: command.input.assessedMinor,
      expectedRemainingMinor: command.input.expectedRemainingMinor,
      taxAccountEventId: event.id,
      settlementAccountId: command.input.settlementAccountId,
      taxAccountControlId: command.input.taxAccountControlId,
      voucherId: null,
      approvalId: null,
      confirmations: command.input.confirmations,
      evidence,
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, "prepare_vat_assessment", principal.actorId),
    };

    const assessment = yield* decode(AssessmentSchema, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertAssessment(transaction, {
      bookId: command.scope.bookId,
      id: assessmentId,
      assessmentIdentity: command.input.assessmentIdentity,
      returnId: basis.id,
      eventId: event.id,
      matchRef: compiled.success.adoptedMatchRef,
      body: yield* toJsonObject(assessment),
      digest: assessment.digest,
      recordedAt: now,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "prepare_vat_assessment",
      principal.actorId,
      yield* toJsonObject(assessment),
    );

    return assessment;
  });
});

export const approveAssessment = Effect.fn("vat.assessment.approveRecord")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly assessmentId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Assessment.ApproveAssessment.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* assessmentAccess(transaction, [...Db.assessmentInserts]);

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "approve_vat_assessment",
      principal.actorId,
      {
        assessmentId: command.assessmentId,
        input: yield* toJsonObject(command.input),
      },
      AssessmentApprovalSchema,
    );

    if (request.previous) return request.previous;

    const assessmentRow = yield* readAssessmentRow(
      transaction,
      command.scope,
      command.assessmentId,
    );

    if (command.input.digest !== assessmentRow.body["digest"]) {
      return yield* failure("StaleDependency");
    }

    if (
      (yield* Db.readAssessmentReceiptByAssessment(
        transaction,
        command.scope.bookId,
        command.assessmentId,
      ))[0] !== undefined
    ) {
      return yield* failure("StaleDependency");
    }

    const ordinal =
      (yield* Db.readAssessmentApprovalCount(
        transaction,
        command.scope.bookId,
        command.assessmentId,
      ))[0]!.total + 1;

    if (ordinal > maximumApprovals) return yield* failure("InvalidJournal");

    const now = yield* isoNow(transaction);

    const body = {
      id: newId("assessment_approval"),
      scope: command.scope,
      assessmentId: command.assessmentId,
      digest: command.input.digest,
      version: 1,
      actorId: principal.actorId,
      ordinal,
      expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, "approve_vat_assessment", principal.actorId),
    };

    const approval = yield* decode(AssessmentApprovalSchema, body);

    yield* Db.insertAssessmentApproval(transaction, {
      bookId: command.scope.bookId,
      id: approval.id,
      assessmentId: command.assessmentId,
      ordinal,
      actorId: principal.actorId,
      digest: approval.digest,
      expiresAt: approval.expiresAt,
      body: yield* toJsonObject(approval),
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "approve_vat_assessment",
      principal.actorId,
      yield* toJsonObject(approval),
    );

    return approval;
  });
});

// Adoption references an already-posted effect: the sealed plan carries no
// journal, so the existing match is re-verified under the execution lock and
// referenced. The match must still exist, still bind this event, and still be
// unused by any other assessment.
function adoptExistingMatch(
  transaction: Transaction,
  scope: Scope,
  assessment: typeof AssessmentSchema.Type,
) {
  return Effect.gen(function* () {
    const matchRef = assessment.plan.adoptedMatchRef;

    if (matchRef === null) return yield* failure("InternalError");

    const match = (yield* TaxDb.readMatch(transaction, scope.bookId, matchRef))[0];

    if (
      match === undefined ||
      match.eventId !== assessment.taxAccountEventId ||
      (yield* Db.readAssessmentByMatch(transaction, scope.bookId, match.id, assessment.id))[0]
        ?.present === true
    ) {
      return yield* failure("StaleDependency");
    }

    return { voucherId: null, matchRef: match.id };
  });
}

export const executeAssessment = Effect.fn("vat.assessment.executeRecord")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly assessmentId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Assessment.ExecuteAssessment.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "execute_vat_assessment";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      { assessmentId: command.assessmentId, input: yield* toJsonObject(command.input) },
      AssessmentSchema,
    );

    if (request.previous) return request.previous;

    yield* assessmentAccess(transaction, [...Db.assessmentInserts]);

    const assessmentRow = yield* readAssessmentRow(
      transaction,
      command.scope,
      command.assessmentId,
    );

    const assessment = yield* decode(AssessmentSchema, assessmentRow.body);

    if (assessment.digest !== command.input.digest) return yield* failure("StaleDependency");

    if (
      (yield* Db.readAssessmentReceiptByAssessment(
        transaction,
        command.scope.bookId,
        assessment.id,
      ))[0] !== undefined
    ) {
      return yield* failure("StaleDependency");
    }

    const approval = (yield* Db.readAssessmentApprovalById(
      transaction,
      command.scope.bookId,
      command.input.approvalId,
      assessment.id,
    ))[0];

    const now = yield* isoNow(transaction);

    if (
      approval === undefined ||
      approval.digest !== assessment.digest ||
      Date.parse(approval.expiresAt) <= Date.parse(now)
    ) {
      return yield* failure("ApprovalRequired");
    }

    if (approval.actorId === principal.actorId) {
      return yield* failure("ApprovalRequired");
    }

    // A new assessment posting settles against the tax-account control account
    // and describes that effect with a tax-account match. The match owner now
    // exposes its internal transaction-passing entrypoint, but the posting
    // cannot run yet: the settlement line lands on a control account, and
    // control-account admission requires the tax-account match to exist first,
    // while the match is defined in terms of the assessment's own journal line.
    // That ordering is a financial-contract decision for the tax-account and
    // posting owners, so the sealed intent stays readable as pending instead of
    // posting a journal that cannot be given its relationship.
    if (assessment.plan.mode === "new_assessment_posting") {
      return yield* failure("UnsupportedProfile");
    }

    const posted = yield* adoptExistingMatch(transaction, command.scope, assessment);

    const receiptId = newId("assessment_receipt");

    const body = {
      id: receiptId,
      scope: command.scope,
      assessmentId: assessment.id,
      approvalId: approval.id,
      voucherId: posted.voucherId,
      matchRef: posted.matchRef,
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
    };

    const receipt = {
      ...body,
      digest: yield* digest(body),
    };

    yield* Db.insertAssessmentReceipt(transaction, {
      bookId: command.scope.bookId,
      id: receiptId,
      assessmentId: assessment.id,
      approvalId: approval.id,
      voucherId: posted.voucherId,
      matchRef: posted.matchRef,
      body: yield* toJsonObject(receipt),
      digest: receipt.digest,
      recordedAt: now,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(assessment),
    );

    return assessment;
  });
});

export const getVatAssessmentStatus = Effect.fn("vat.assessment.status")(function* (
  token: string,
  command: { readonly scope: Scope; readonly returnId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* assessmentAccess(transaction, []);

    const basis = yield* readReturnRow(transaction, command.scope, command.returnId);
    const settlementBindingId = yield* settlementBinding(basis.body);

    const bridges = yield* Db.readBridgesForReturn(transaction, command.scope.bookId, basis.id);

    if (bridges.length > 100) return yield* unsupported();

    const assessments = yield* Db.readAssessmentsForReturn(
      transaction,
      command.scope.bookId,
      basis.id,
    );

    if (assessments.length > 100) return yield* unsupported();

    const executedBridgeDeltas: Array<string> = [];
    const bridgeIds: Array<string> = [];

    for (const bridge of bridges) {
      bridgeIds.push(bridge.id);

      const receipt = (yield* Db.readBridgeReceiptByBridge(
        transaction,
        command.scope.bookId,
        bridge.id,
      ))[0];

      if (receipt !== undefined) {
        executedBridgeDeltas.push(bridge.deltaMinor);
      }
    }

    const executedAssessed: Array<string> = [];
    const assessmentIds: Array<string> = [];
    const adoptedVoucherIds = new Set<string>();
    let pendingDifferenceTotal = 0n;
    let discrepancy = false;
    const blockers: Array<string> = [];

    for (const row of assessments) {
      assessmentIds.push(row.id);

      const record = yield* decode(AssessmentSchema, row.body);

      const receipt = (yield* Db.readAssessmentReceiptByAssessment(
        transaction,
        command.scope.bookId,
        record.id,
      ))[0];

      if (receipt === undefined) {
        blockers.push(`assessment ${record.assessmentIdentity} awaits execution`);

        continue;
      }

      const receiptBody = yield* decode(AssessmentReceiptSchema, receipt.body);

      if (receiptBody.matchRef !== null) {
        const match = (yield* TaxDb.readMatch(
          transaction,
          command.scope.bookId,
          receiptBody.matchRef,
        ))[0];

        if (match?.voucherId !== undefined) {
          adoptedVoucherIds.add(match.voucherId);
        }
      }

      executedAssessed.push(record.assessedMinor);
      pendingDifferenceTotal += BigInt(record.plan.pendingDifferenceMinor);

      if (record.plan.pendingDifferenceMinor !== "0") {
        discrepancy = true;
      }
    }

    // The expected settlement control assembles every committed vector
    // through its own owner's records: reclassification effects in the
    // return's interval (adopted assessment vouchers excluded so one journal
    // is never counted twice), executed bridge deltas and executed adopted
    // assessments. Amendments carry no financial effect in their owner, so
    // they contribute none here.
    const reclassificationVectors: Array<string> = [];

    if (settlementBindingId !== null) {
      const effects = yield* ActualDb.readControlEffectsInInterval(
        transaction,
        command.scope.bookId,
        basis.startsOn,
        basis.endsOn,
      );

      for (const effect of effects) {
        if (effect.voucherId === null || adoptedVoucherIds.has(effect.voucherId)) continue;

        const lines = yield* Db.readVoucherLines(
          transaction,
          command.scope.bookId,
          effect.voucherId,
        );

        const signed = lines
          .filter((line) => line.accountId === settlementBindingId)
          .reduce((total, line) => total + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);

        reclassificationVectors.push(signed.toString());
      }
    }

    const expectedSettlementMinor = expectedSettlementControl(
      reclassificationVectors,
      executedBridgeDeltas,
      executedAssessed,
    );

    return yield* decode(Assessment.VatAssessmentStatus, {
      scope: command.scope,
      returnId: basis.id,
      exactNetMinor: basis.exactNetMinor,
      reportedNetMinor: basis.reportedNetMinor,
      residualNetMinor: basis.residualNetMinor,
      bridgeDeltaTotalMinor: executedBridgeDeltas
        .reduce((total, delta) => total + BigInt(delta), 0n)
        .toString(),
      assessedTotalMinor: executedAssessed
        .reduce((total, assessed) => total + BigInt(assessed), 0n)
        .toString(),
      expectedSettlementMinor,
      pendingDifferenceTotalMinor: pendingDifferenceTotal.toString(),
      discrepancy,
      bridgeIds,
      assessmentIds,
      blockers,
    });
  });
});

const AssessmentReceiptSchema = Schema.Struct({
  matchRef: Schema.NullOr(Accounting.Identifier),
});

export const vatAssessmentHistory = Effect.fn("vat.assessment.history")(function* (
  token: string,
  command: { readonly scope: Scope; readonly returnId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* assessmentAccess(transaction, []);

    yield* readReturnRow(transaction, command.scope, command.returnId);

    const bridges = yield* Db.readBridgesForReturn(
      transaction,
      command.scope.bookId,
      command.returnId,
    );

    const assessments = yield* Db.readAssessmentsForReturn(
      transaction,
      command.scope.bookId,
      command.returnId,
    );

    const items: Array<(typeof Assessment.VatAssessmentHistory.Type)["items"][number]> = [];

    for (const bridge of bridges) {
      const record = yield* decode(BridgeSchema, bridge.body);

      items.push({
        id: bridge.id,
        kind: "bridge",
        digest: record.digest,
        createdAt: record.createdAt,
      });
    }

    for (const row of assessments) {
      const record = yield* decode(AssessmentSchema, row.body);

      items.push({
        id: row.id,
        kind: "assessment",
        digest: record.digest,
        createdAt: record.createdAt,
      });
    }

    items.sort((left, right) =>
      left.createdAt < right.createdAt
        ? -1
        : left.createdAt > right.createdAt
          ? 1
          : left.id < right.id
            ? -1
            : 1,
    );

    if (items.length > 100) return yield* failure("InvalidJournal");

    return yield* decode(Assessment.VatAssessmentHistory, {
      scope: command.scope,
      returnId: command.returnId,
      complete: true,
      count: items.length,
      items,
    });
  });
});
