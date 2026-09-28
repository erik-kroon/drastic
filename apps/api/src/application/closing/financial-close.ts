import * as Accounting from "@open-erp/contracts/accounting";
import * as Close from "@open-erp/contracts/financial-close";
import * as Statements from "@open-erp/contracts/report-statements";
import * as Tax from "@open-erp/contracts/corporate-tax";
import {
  assertCloseConservation,
  sealFinalProposal,
  type CloseFailure,
} from "@open-erp/domain/financial-close";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { captureFinancialBasis } from "./financial-basis";
import { executedBridgeIsCurrent } from "../tax/corporate";
import {
  withFinancialApproval as withCloseApproval,
  reviewerIsCurrent,
} from "./financial-authority";
import {
  approveChangeInTransaction,
  digest,
  executeChangeInTransaction,
  isoNow,
  newId,
  replay,
  saveCommand,
  sealActionInTransaction,
  sha256Hex,
} from "../posting";
import * as Db from "../../db/closing/financial-close";
import * as StatementDb from "../../db/report-statements";
import * as CorpDb from "../../db/tax/corporate";
import * as Ledger from "../../db/posting";
import { readTableAccess } from "../../db/commerce/access";
import type { Transaction } from "../../db/transaction";
import {
  commandReceipt,
  decode,
  readEvidenceReference,
  textField,
  toJsonObject,
  unsupported,
  withBook as withReadBook,
  type Scope,
} from "../commerce/support";

const withBook: typeof withReadBook = (token, scope, operatorOnly, operation) =>
  withReadBook(token, scope, operatorOnly, operation, operatorOnly ? "update" : "share");

const PreparationSchema = Close.ClosePreparation;

const ProposalSchema = Close.FinalCloseProposal;

const ApprovalSchema = Close.FinalProposalApproval;

const CertificateSchema = Close.FinancialCloseCertificate;

const OpeningSchema = Close.FinancialOpeningSet;

const SnapshotSchema = Statements.StatementSnapshot;

const RowSchema = Statements.StatementModelRow;

const BridgeSchema = Tax.TaxBridge;

const maximumApprovals = 50;

const approvalWindowMs = 60 * 60 * 1000;

const maximumBsRows = 500;

function closeAccess(transaction: Transaction, inserts: ReadonlyArray<string>) {
  return readTableAccess(transaction, [...Db.financialCloseTables]).pipe(
    Effect.flatMap((rows) => {
      const denied = Db.financialCloseTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);

        return (
          access === undefined || !access.canSelect || (inserts.includes(name) && !access.canInsert)
        );
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function refusalFor(failureValue: CloseFailure) {
  return failureValue.code === "MissingRequiredControl" || failureValue.code === "StaleCloseBasis"
    ? failure("StaleDependency")
    : failure("InvalidJournal");
}

function readYear(transaction: Transaction, bookId: string, fiscalYearId: string) {
  return Ledger.readFiscalYear(transaction, bookId, fiscalYearId).pipe(
    Effect.flatMap((rows) => {
      const year = rows[0];

      return year ? Effect.succeed(year) : failure("NotFound");
    }),
  );
}

type RetainedSnapshot = {
  readonly snapshot: typeof SnapshotSchema.Type;
  readonly digest: string;
};

function readRetainedSnapshot(transaction: Transaction, scope: Scope, snapshotId: string) {
  return Effect.gen(function* () {
    const header = (yield* StatementDb.readStatementSnapshot(
      transaction,
      scope.bookId,
      snapshotId,
    ))[0];

    if (header === undefined) return yield* failure("NotFound");

    const snapshot = yield* decode(SnapshotSchema, header.body);

    if (snapshot.scope.bookId !== scope.bookId) return yield* failure("StaleDependency");

    return { snapshot, digest: yield* digest(header.body) } satisfies RetainedSnapshot;
  });
}

type BridgeBasis = {
  readonly bridge: typeof BridgeSchema.Type;
  readonly digest: string;
  readonly recognizedMinor: string;
  readonly effectId: string;
  readonly receiptId: string;
};

function readBridgeBasis(
  transaction: Transaction,
  scope: Scope,
  bridgeId: string,
  fiscalYearId: string,
) {
  return Effect.gen(function* () {
    const row = (yield* CorpDb.readBridge(transaction, scope.bookId, bridgeId))[0];

    if (row === undefined) return yield* failure("NotFound");

    if (row.fiscalYearId !== fiscalYearId) return yield* failure("StaleDependency");

    const bridge = yield* decode(BridgeSchema, row.body);

    if (!(yield* executedBridgeIsCurrent(transaction, scope, bridge, row)))
      return yield* failure("StaleDependency");

    const recognized = (yield* CorpDb.readRecognizedForYear(
      transaction,
      scope.bookId,
      fiscalYearId,
    ))[0];

    if (recognized === undefined) return yield* failure("InternalError");

    const effectRow = (yield* CorpDb.readEffectByBridge(transaction, scope.bookId, bridgeId))[0];

    if (!effectRow || recognized.minor !== bridge.currentTaxTargetMinor)
      return yield* failure("StaleDependency");

    const effect = yield* decode(Tax.CorporateTaxEffect, effectRow.body);

    if (
      effect.bridgeDigest !== bridge.digest ||
      effect.yearTaxTargetMinor !== bridge.currentTaxTargetMinor ||
      effect.recognizedAfterMinor !== recognized.minor ||
      (yield* Db.readTaxReceipt(
        transaction,
        scope.bookId,
        effect.groupReceiptId,
        bridge.changeSetId,
      )).length !== 1
    )
      return yield* failure("StaleDependency");

    return {
      bridge,
      digest: row.digest,
      recognizedMinor: recognized.minor,
      effectId: effect.id,
      receiptId: effect.groupReceiptId,
    } satisfies BridgeBasis;
  });
}

// The close conservation boundary, shared by preparation, advance and
// execution. The sealed statement snapshot must still describe the current
// ledger: no reopen covering its as-of date, and no voucher committed after
// its cutoff other than this owner's own committed transfer postings for the
// reported year and the corporate-tax owner's committed effects. Refusing a
// proposal costs a fresh snapshot while closing over a moved population is
// not recoverable, so the boundary errs toward refusal exactly as the
// corporate-tax bridge does.
function snapshotIsCurrent(
  transaction: Transaction,
  scope: Scope,
  snapshot: RetainedSnapshot["snapshot"],
  fiscalYearId: string,
) {
  return Effect.gen(function* () {
    const live = (yield* StatementDb.readStatementLiveStatus(
      transaction,
      scope.bookId,
      snapshot.ledgerBoundary,
      snapshot.asOf,
      snapshot.createdAt,
    ))[0];

    if (live === undefined) return yield* failure("InternalError");

    if (live.reopenedAfterCapture) return false;

    const own = (yield* Db.readOwnTransferPostingsAfter(
      transaction,
      scope.bookId,
      fiscalYearId,
      snapshot.ledgerBoundary,
    ))[0];

    if (own === undefined) return yield* failure("InternalError");

    const tax = (yield* CorpDb.readOwnEffectPostingsAfter(
      transaction,
      scope.bookId,
      fiscalYearId,
      snapshot.ledgerBoundary,
    ))[0];

    if (tax === undefined) return yield* failure("InternalError");

    const foreign = BigInt(live.postingsAfterCutoff) - BigInt(own.count) - BigInt(tax.count);

    if (foreign < 0n) return yield* failure("InternalError");

    return foreign === 0n;
  });
}

function readBsRows(transaction: Transaction, scope: Scope, snapshotId: string) {
  return Effect.gen(function* () {
    const rows: Array<{ readonly rowId: string; readonly closingMinor: string }> = [];
    let cursor = 0;

    for (;;) {
      const page = (yield* StatementDb.readStatementRowPage(
        transaction,
        scope.bookId,
        snapshotId,
        "balance_sheet",
        cursor,
        StatementDb.statementSnapshotPageSize,
      ))[0];

      if (page === undefined) return yield* failure("InternalError");

      const parsed = Schema.decodeOption(Schema.Array(Schema.JsonObject))(page.items);
      const items = Option.isSome(parsed) ? parsed.value : null;

      if (items === null) return yield* failure("InternalError");

      for (const item of items) {
        const row = yield* decode(RowSchema, item);
        rows.push({ rowId: row.rowId, closingMinor: row.closingMinor });
      }

      if (page.nextOrdinal === null) break;

      cursor = Number(page.nextOrdinal);

      if (rows.length > maximumBsRows) return yield* unsupported();
    }

    return rows;
  });
}

function basisVersion(parts: {
  readonly snapshotDigest: string;
  readonly bridgeDigest: string;
  readonly recognizedMinor: string;
  readonly priorTransferMinor: string;
  readonly currentDigest: string;
}) {
  return digest(parts);
}

type Chain = {
  readonly preparations: ReadonlyArray<Db.PreparationRow>;
  readonly proposalsByPreparation: ReadonlyMap<string, Db.ProposalRow>;
  readonly certificatesByProposal: ReadonlyMap<string, Db.BodyRow>;
  readonly reopensByCertificate: ReadonlyMap<string, Db.BodyRow>;
};

function readChain(transaction: Transaction, scope: Scope, fiscalYearId: string) {
  return Effect.gen(function* () {
    const preparations = yield* Db.readPreparationsForYear(transaction, scope.bookId, fiscalYearId);
    const proposalsByPreparation = new Map<string, Db.ProposalRow>();
    const certificatesByProposal = new Map<string, Db.BodyRow>();
    const reopensByCertificate = new Map<string, Db.BodyRow>();

    for (const preparation of preparations) {
      const proposal = (yield* Db.readProposalByPreparation(
        transaction,
        scope.bookId,
        preparation.id,
      ))[0];

      if (proposal === undefined) continue;

      proposalsByPreparation.set(preparation.id, proposal);

      const certificate = (yield* Db.readCertificateByProposal(
        transaction,
        scope.bookId,
        proposal.id,
      ))[0];

      if (certificate === undefined) continue;

      certificatesByProposal.set(proposal.id, certificate);

      const reopen = (yield* Db.readReopenForCertificate(
        transaction,
        scope.bookId,
        certificate.id,
      ))[0];

      if (reopen !== undefined) reopensByCertificate.set(certificate.id, reopen);
    }

    return { preparations, proposalsByPreparation, certificatesByProposal, reopensByCertificate };
  });
}

function executedReopen(
  reopensByCertificate: ReadonlyMap<string, Db.BodyRow>,
  certificateId: string,
) {
  const reopen = reopensByCertificate.get(certificateId);

  if (reopen === undefined) return false;

  const refusals = reopen.body["downstreamRefusals"];

  return Array.isArray(refusals) ? refusals.length === 0 : false;
}

export const prepareYearClose = Effect.fn("closing.financial-close.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Close.PrepareYearClose.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "prepare_financial_close",
      principal.actorId,
      yield* toJsonObject(command.input),
      PreparationSchema,
    );

    if (request.previous) return request.previous;

    yield* closeAccess(transaction, [...Db.financialCloseInserts]);

    const book = (yield* Ledger.readBook(transaction, command.scope))[0];

    if (!book) return yield* failure("Forbidden");

    if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
      return yield* unsupported();

    const year = yield* readYear(transaction, command.scope.bookId, command.input.fiscalYearId);
    const chain = yield* readChain(transaction, command.scope, command.input.fiscalYearId);

    const activeCertificate = [...chain.certificatesByProposal.values()].find(
      (certificate) => !executedReopen(chain.reopensByCertificate, certificate.id),
    );

    if (activeCertificate !== undefined) return yield* failure("AlreadyPosted");

    const retained = yield* readRetainedSnapshot(
      transaction,
      command.scope,
      command.input.statementSnapshotId,
    );

    if (
      retained.snapshot.fiscalYear.id !== year.id ||
      retained.snapshot.asOf < year.startsOn ||
      retained.snapshot.asOf > year.endsOn ||
      retained.snapshot.currency !== book.currency
    ) {
      return yield* failure("StaleDependency");
    }

    if (!(yield* snapshotIsCurrent(transaction, command.scope, retained.snapshot, year.id))) {
      return yield* failure("StaleDependency");
    }

    const current = yield* captureFinancialBasis(
      transaction,
      command.scope,
      retained.snapshot,
      command.input.nominalAccountId,
      command.input.equityAccountId,
    );

    const bridge = yield* readBridgeBasis(
      transaction,
      command.scope,
      command.input.bridgeId,
      year.id,
    );

    if (bridge.bridge.overlay.statementSnapshotId !== retained.snapshot.id) {
      return yield* failure("StaleDependency");
    }

    const evidence = yield* readEvidenceReference(
      transaction,
      command.scope.bookId,
      command.input.evidenceId,
    );

    const receiptIds = command.input.adjustmentReceiptIds ?? [];

    if (receiptIds.length !== command.input.proposedAdjustmentRefs.length)
      return yield* failure("StaleDependency");

    for (const [index, adjustment] of command.input.proposedAdjustmentRefs.entries()) {
      if (
        (yield* Db.readAdjustmentReceipts(
          transaction,
          command.scope.bookId,
          adjustment.evidenceId,
          adjustment.sha256,
          receiptIds[index]!,
          year.id,
        )).length !== 1
      )
        return yield* failure("StaleDependency");
    }

    const seenFamilies = new Set<string>();

    for (const claim of command.input.otherFamilies) {
      if (
        claim.familyId === "statements" ||
        claim.familyId === "corporate_tax" ||
        seenFamilies.has(claim.familyId)
      ) {
        return yield* failure("InvalidJournal");
      }

      seenFamilies.add(claim.familyId);

      yield* readEvidenceReference(transaction, command.scope.bookId, claim.evidenceId);
    }

    const familyControls = [
      {
        familyId: "statements",
        status: "required_met" as const,
        evidenceId: retained.snapshot.id,
      },
      {
        familyId: "corporate_tax",
        status: "required_met" as const,
        evidenceId: bridge.bridge.id,
      },
      ...current.controls,
    ];

    const priorTransfers = yield* Db.readTransfersForYear(
      transaction,
      command.scope.bookId,
      year.id,
    );

    const priorTransferMinor = priorTransfers
      .reduce((total, row) => total + BigInt(row.deltaMinor), 0n)
      .toString();

    const version = yield* basisVersion({
      snapshotDigest: retained.digest,
      bridgeDigest: bridge.digest,
      recognizedMinor: bridge.recognizedMinor,
      priorTransferMinor,
      currentDigest: current.digest,
    });

    const preparationId = newId("close_preparation");

    const body = {
      id: preparationId,
      scope: command.scope,
      version: 1,
      fiscalYearId: year.id,
      input: yield* toJsonObject(command.input),
      statementSnapshotId: retained.snapshot.id,
      statementDigest: retained.digest,
      statementResultMinor: current.profitMinor,
      currentBasisDigest: current.digest,
      taxEffectId: bridge.effectId,
      taxReceiptId: bridge.receiptId,
      bridgeId: bridge.bridge.id,
      bridgeDigest: bridge.digest,
      recognizedTaxMinor: bridge.recognizedMinor,
      familyControls,
      closeBasisVersion: version,
      evidence,
      createdAt: yield* isoNow(transaction),
      receipt: commandReceipt(command.idempotencyKey, "prepare_financial_close", principal.actorId),
    };

    const preparation = yield* decode(PreparationSchema, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertPreparation(transaction, {
      bookId: command.scope.bookId,
      id: preparationId,
      fiscalYearId: year.id,
      statementSnapshotId: retained.snapshot.id,
      bridgeId: bridge.bridge.id,
      body: yield* toJsonObject(preparation),
      digest: preparation.digest,
      recordedAt: preparation.createdAt,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "prepare_financial_close",
      principal.actorId,
      yield* toJsonObject(preparation),
    );

    return preparation;
  });
});

function readPreparationRow(transaction: Transaction, scope: Scope, preparationId: string) {
  return Db.readPreparation(transaction, scope.bookId, preparationId).pipe(
    Effect.flatMap((rows) => {
      const preparation = rows[0];

      return preparation ? Effect.succeed(preparation) : failure("NotFound");
    }),
  );
}

function readProposalRow(transaction: Transaction, scope: Scope, proposalId: string) {
  return Db.readProposal(transaction, scope.bookId, proposalId).pipe(
    Effect.flatMap((rows) => {
      const proposal = rows[0];

      return proposal ? Effect.succeed(proposal) : failure("NotFound");
    }),
  );
}

// The final proposal is sealed only when every required family control is
// satisfied and the approved current-tax bridge receipt is present. No
// approval silently survives a changed economic proposal: the basis is
// recaptured here, and execution rechecks it again inside its own
// transaction.
export const advanceYearClose = Effect.fn("closing.financial-close.advance")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly preparationId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Close.AdvanceYearClose.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "advance_financial_close",
      principal.actorId,
      {
        preparationId: command.preparationId,
        input: yield* toJsonObject(command.input),
      },
      ProposalSchema,
    );

    if (request.previous) return request.previous;

    yield* closeAccess(transaction, [...Db.financialCloseInserts]);

    const book = (yield* Ledger.readBook(transaction, command.scope))[0];

    if (!book) return yield* failure("Forbidden");

    if (book.profile !== "synthetic-core-v1" || book.authority !== "native")
      return yield* unsupported();

    const preparationRow = yield* readPreparationRow(
      transaction,
      command.scope,
      command.preparationId,
    );

    const preparation = yield* decode(PreparationSchema, preparationRow.body);

    if (command.input.preparationDigest !== preparation.digest) {
      return yield* failure("StaleDependency");
    }

    if (
      (yield* Db.readProposalByPreparation(
        transaction,
        command.scope.bookId,
        preparation.id,
      ))[0] !== undefined
    ) {
      return yield* failure("AlreadyPosted");
    }

    const year = yield* readYear(transaction, command.scope.bookId, preparation.fiscalYearId);

    const retained = yield* readRetainedSnapshot(
      transaction,
      command.scope,
      preparation.statementSnapshotId,
    );

    if (retained.digest !== preparation.statementDigest) {
      return yield* failure("StaleDependency");
    }

    if (!(yield* snapshotIsCurrent(transaction, command.scope, retained.snapshot, year.id))) {
      return yield* failure("StaleDependency");
    }

    const current = yield* captureFinancialBasis(
      transaction,
      command.scope,
      retained.snapshot,
      preparation.input.nominalAccountId,
      preparation.input.equityAccountId,
    );

    const bridge = yield* readBridgeBasis(
      transaction,
      command.scope,
      preparation.bridgeId,
      year.id,
    );

    if (bridge.digest !== preparation.bridgeDigest) {
      return yield* failure("StaleDependency");
    }

    const period = (yield* Ledger.readPeriod(
      transaction,
      command.scope.bookId,
      command.input.accountingPeriodId,
    ))[0];

    if (
      period === undefined ||
      period.fiscalYearId !== year.id ||
      period.locked ||
      command.input.postingDate < period.startsOn ||
      command.input.postingDate > period.endsOn ||
      command.input.postingDate < year.startsOn ||
      command.input.postingDate > year.endsOn
    ) {
      return yield* failure("InvalidJournal");
    }

    const priorTransfers = yield* Db.readTransfersForYear(
      transaction,
      command.scope.bookId,
      year.id,
    );

    const priorTransferMinor = priorTransfers
      .reduce((total, row) => total + BigInt(row.deltaMinor), 0n)
      .toString();

    const sealed = sealFinalProposal({
      yearId: year.id,
      controls: preparation.familyControls.map((control) => ({
        familyId: control.familyId,
        status: control.status,
        evidenceId: control.evidenceId,
      })),
      taxBridgeReceiptId: bridge.receiptId,
      transfer: {
        profitMinor: preparation.statementResultMinor,
        priorTransferMinor,
        roles: {
          nominalResultTransferAccountId: preparation.input.nominalAccountId,
          yearResultEquityAccountId: preparation.input.equityAccountId,
        },
      },
      closeBasisVersion: preparation.closeBasisVersion,
    });

    if (Result.isFailure(sealed)) return yield* refusalFor(sealed.failure);

    if (
      current.digest !== preparation.currentBasisDigest ||
      current.profitMinor !== preparation.statementResultMinor
    )
      return yield* failure("StaleDependency");

    const version = yield* basisVersion({
      snapshotDigest: retained.digest,
      bridgeDigest: bridge.digest,
      recognizedMinor: bridge.recognizedMinor,
      priorTransferMinor,
      currentDigest: current.digest,
    });

    if (version !== preparation.closeBasisVersion) {
      return yield* failure("StaleDependency");
    }

    // Decode the retained membership as well; presentation rows are evidence,
    // never account identities or a source of opening balances.
    yield* readBsRows(transaction, command.scope, retained.snapshot.id);

    const openingTarget = current.opening.map((row) => ({
      ...row,
      balanceMinor:
        row.accountId === preparation.input.equityAccountId
          ? (BigInt(row.balanceMinor) - BigInt(sealed.success.transfer.deltaMinor)).toString()
          : row.balanceMinor,
    }));

    if (
      BigInt(current.nominalMinor) + BigInt(sealed.success.transfer.deltaMinor) !== 0n ||
      openingTarget.reduce((sum, row) => sum + BigInt(row.balanceMinor), 0n) !== 0n
    )
      return yield* failure("InvalidJournal");

    const proposalId = newId("close_proposal");

    const body = {
      id: proposalId,
      scope: command.scope,
      version: 1,
      preparationId: preparation.id,
      preparationDigest: preparation.digest,
      fiscalYearId: year.id,
      plan: sealed.success,
      profitMinor: preparation.statementResultMinor,
      priorTransferMinor,
      transferJournal: sealed.success.transfer.journal.map((line) => ({
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
      })),
      openingTarget,
      nominalAccountId: preparation.input.nominalAccountId,
      equityAccountId: preparation.input.equityAccountId,
      accountingPeriodId: command.input.accountingPeriodId,
      postingDate: command.input.postingDate,
      series: command.input.series,
      createdAt: yield* isoNow(transaction),
      receipt: commandReceipt(command.idempotencyKey, "advance_financial_close", principal.actorId),
    };

    const proposal = yield* decode(ProposalSchema, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertProposal(transaction, {
      bookId: command.scope.bookId,
      id: proposalId,
      preparationId: preparation.id,
      fiscalYearId: year.id,
      body: yield* toJsonObject(proposal),
      digest: proposal.digest,
      recordedAt: proposal.createdAt,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "advance_financial_close",
      principal.actorId,
      yield* toJsonObject(proposal),
    );

    return proposal;
  });
});

function closeProposalBlockers(
  transaction: Transaction,
  scope: Scope,
  proposalRow: Db.ProposalRow,
) {
  return Effect.gen(function* () {
    const proposal = yield* decode(ProposalSchema, proposalRow.body);

    if (
      (yield* Db.readCertificateByProposal(transaction, scope.bookId, proposal.id))[0] !== undefined
    ) {
      return ["This final proposal already has a retained certificate."] as const;
    }

    const preparationRow = yield* readPreparationRow(transaction, scope, proposal.preparationId);
    const preparation = yield* decode(PreparationSchema, preparationRow.body);

    const snapshot = yield* readRetainedSnapshot(
      transaction,
      scope,
      preparation.statementSnapshotId,
    );

    if (!(yield* snapshotIsCurrent(transaction, scope, snapshot.snapshot, proposal.fiscalYearId))) {
      return ["The close basis moved after the final proposal was sealed."] as const;
    }

    const periods = yield* Db.readPeriodsOfYear(transaction, scope.bookId, proposal.fiscalYearId);
    const posting = periods.find((period) => period.id === proposal.accountingPeriodId);

    if (posting === undefined || posting.locked) {
      return ["The designated year-end posting period is no longer available."] as const;
    }

    return [] as const;
  });
}

export const approveFinalProposal = Effect.fn("closing.financial-close.approve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly proposalId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Close.ApproveFinalProposal.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "approve_financial_close",
      principal.actorId,
      {
        proposalId: command.proposalId,
        input: yield* toJsonObject(command.input),
      },
      ApprovalSchema,
    );

    if (request.previous) return request.previous;

    yield* closeAccess(transaction, [...Db.financialCloseInserts]);

    const proposalRow = yield* readProposalRow(transaction, command.scope, command.proposalId);

    const proposed = yield* decode(ProposalSchema, proposalRow.body);

    const preparedRow = yield* readPreparationRow(
      transaction,
      command.scope,
      proposed.preparationId,
    );

    const prepared = yield* decode(PreparationSchema, preparedRow.body);

    if ([proposed.receipt.actorId, prepared.receipt.actorId].includes(principal.actorId))
      return yield* failure("ApprovalRequired");

    const retained = yield* readRetainedSnapshot(
      transaction,
      command.scope,
      prepared.statementSnapshotId,
    );

    const current = yield* captureFinancialBasis(
      transaction,
      command.scope,
      retained.snapshot,
      proposed.nominalAccountId,
      proposed.equityAccountId,
    );

    if (current.digest !== prepared.currentBasisDigest) return yield* failure("StaleDependency");

    yield* readBridgeBasis(transaction, command.scope, prepared.bridgeId, proposed.fiscalYearId);

    if (command.input.digest !== textField(proposalRow.body, "digest")) {
      return yield* failure("StaleDependency");
    }

    const blockers = yield* closeProposalBlockers(transaction, command.scope, proposalRow);

    if (blockers.length > 0) return yield* failure("StaleDependency");

    const ordinal =
      (yield* Db.readApprovalCount(transaction, command.scope.bookId, command.proposalId))[0]!
        .total + 1;

    if (ordinal > maximumApprovals) return yield* failure("InvalidJournal");

    const now = yield* isoNow(transaction);

    const body = {
      id: newId("close_approval"),
      scope: command.scope,
      proposalId: command.proposalId,
      digest: command.input.digest,
      version: 1,
      actorId: principal.actorId,
      ordinal,
      expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, "approve_financial_close", principal.actorId),
    };

    const approval = yield* decode(ApprovalSchema, body);

    yield* Db.insertApproval(transaction, {
      bookId: command.scope.bookId,
      id: approval.id,
      proposalId: command.proposalId,
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
      "approve_financial_close",
      principal.actorId,
      yield* toJsonObject(approval),
    );

    return approval;
  });
});

export const executeFinalClose = Effect.fn("closing.financial-close.execute")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly proposalId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Close.ExecuteFinalClose.Type;
  },
) {
  return yield* withCloseApproval(
    token,
    command.scope,
    command.proposalId,
    command.input.approvalId,
    function* (transaction, principal) {
      const operation = "execute_financial_close";

      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { proposalId: command.proposalId, input: yield* toJsonObject(command.input) },
        CertificateSchema,
      );

      if (request.previous) return request.previous;

      yield* closeAccess(transaction, [...Db.financialCloseInserts]);

      const book = (yield* Ledger.readBook(transaction, command.scope))[0];

      if (!book) return yield* failure("Forbidden");

      const proposalRow = yield* readProposalRow(transaction, command.scope, command.proposalId);
      const proposal = yield* decode(ProposalSchema, proposalRow.body);

      if (
        proposal.digest !== command.input.digest ||
        (yield* closeProposalBlockers(transaction, command.scope, proposalRow)).length > 0
      ) {
        return yield* failure("StaleDependency");
      }

      const approval = (yield* Db.readApprovalById(
        transaction,
        command.scope.bookId,
        command.input.approvalId,
        command.proposalId,
      ))[0];

      const now = yield* isoNow(transaction);

      if (
        approval === undefined ||
        approval.digest !== proposal.digest ||
        Date.parse(approval.expiresAt) <= Date.parse(now) ||
        (yield* Db.readCertificateByProposal(
          transaction,
          command.scope.bookId,
          approval.proposalId,
        ))[0] !== undefined
      ) {
        return yield* failure("ApprovalRequired");
      }

      // Four-eyes separation: the operator who approved the final proposal may
      // not be the operator who executes it. The kernel approval below is the
      // execution authorization, not a second human review.
      if (approval.actorId === principal.actorId) {
        return yield* failure("ApprovalRequired");
      }

      if (!(yield* reviewerIsCurrent(transaction, command.scope.bookId, approval.actorId)))
        return yield* failure("ApprovalRequired");

      const chain = yield* readChain(transaction, command.scope, proposal.fiscalYearId);

      const activeCertificate = [...chain.certificatesByProposal.values()].find(
        (certificate) => !executedReopen(chain.reopensByCertificate, certificate.id),
      );

      if (activeCertificate !== undefined) return yield* failure("AlreadyPosted");

      const preparationRow = yield* readPreparationRow(
        transaction,
        command.scope,
        proposal.preparationId,
      );

      const preparation = yield* decode(PreparationSchema, preparationRow.body);

      const retained = yield* readRetainedSnapshot(
        transaction,
        command.scope,
        preparation.statementSnapshotId,
      );

      const current = yield* captureFinancialBasis(
        transaction,
        command.scope,
        retained.snapshot,
        proposal.nominalAccountId,
        proposal.equityAccountId,
      );

      const bridge = yield* readBridgeBasis(
        transaction,
        command.scope,
        preparation.bridgeId,
        proposal.fiscalYearId,
      );

      const priorTransfers = yield* Db.readTransfersForYear(
        transaction,
        command.scope.bookId,
        proposal.fiscalYearId,
      );

      const priorTransferMinor = priorTransfers
        .reduce((total, row) => total + BigInt(row.deltaMinor), 0n)
        .toString();

      if (priorTransferMinor !== proposal.priorTransferMinor) {
        return yield* failure("StaleDependency");
      }

      if (
        current.digest !== preparation.currentBasisDigest ||
        bridge.effectId !== preparation.taxEffectId ||
        bridge.receiptId !== preparation.taxReceiptId
      )
        return yield* failure("StaleDependency");

      const version = yield* basisVersion({
        snapshotDigest: retained.digest,
        bridgeDigest: bridge.digest,
        recognizedMinor: bridge.recognizedMinor,
        priorTransferMinor,
        currentDigest: current.digest,
      });

      if (version !== preparation.closeBasisVersion) {
        return yield* failure("StaleDependency");
      }

      const conserved = assertCloseConservation(proposal.plan, {
        closeBasisVersion: version,
        controls: preparation.familyControls.map((control) => ({
          familyId: control.familyId,
          status: control.status,
          evidenceId: control.evidenceId,
        })),
      });

      if (Result.isFailure(conserved)) return yield* refusalFor(conserved.failure);

      const delta = proposal.plan.transfer.deltaMinor;
      const consumesVoucher = proposal.plan.transfer.consumesVoucher;
      let transferVoucherId: string | null = null;

      if (consumesVoucher) {
        const eventKey = `financial_close_${proposal.fiscalYearId}`;

        const eventRows = yield* Ledger.readEvent(
          transaction,
          command.scope.bookId,
          preparation.evidence.evidenceId,
          eventKey,
        );

        const eventId =
          eventRows[0]?.id ??
          (yield* Ledger.insertEvent(
            transaction,
            command.scope.bookId,
            newId("event"),
            preparation.evidence.evidenceId,
            eventKey,
          ))[0]?.id;

        if (eventId === undefined) return yield* failure("InternalError");

        const occurrenceSeed = yield* sha256Hex(`${proposal.id}:${proposal.digest}`);

        const action = yield* decode(Accounting.VoucherPostingAction, {
          kind: "post_voucher",
          correctsVoucherId: null,
          eventId,
          postingPurpose: "result_transfer_v1",
          occurrenceKey: `result_transfer_${occurrenceSeed.slice(0, 32)}`,
          fiscalYearId: proposal.fiscalYearId,
          accountingPeriodId: proposal.accountingPeriodId,
          postingDate: proposal.postingDate,
          series: proposal.series,
          currency: book.currency,
          description: `Year result transfer ${proposal.fiscalYearId}`,
          rationale: preparation.input.reason,
          taxAssessment: "not_applicable",
          lines: proposal.transferJournal.map((line) => ({
            lineId: newId("line"),
            accountId: line.accountId,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
            description: line.description,
          })),
          evidenceRefs: [
            {
              evidenceId: preparation.evidence.evidenceId,
              sha256: preparation.evidence.sha256,
              locator: eventKey,
            },
          ],
          resultTransfer: {
            proposalId: proposal.id,
            fiscalYearId: proposal.fiscalYearId,
            deltaMinor: delta,
          },
        });

        const plan = yield* sealActionInTransaction(
          transaction,
          principal,
          command.scope,
          action,
          false,
          true,
        );

        const kernel = yield* approveChangeInTransaction(transaction, principal, {
          scope: command.scope,
          changeSetId: plan.id,
          idempotencyKey: newId("close_approve"),
          input: { version: 1, planDigest: plan.planDigest },
          owner: { kind: "financial_close", id: proposal.id },
        });

        const postingReceipt = yield* executeChangeInTransaction(transaction, principal, {
          scope: command.scope,
          changeSetId: plan.id,
          idempotencyKey: newId("close_post"),
          input: { version: 1, planDigest: plan.planDigest, approvalId: kernel.id },
          owner: { kind: "financial_close", id: proposal.id },
        });

        transferVoucherId = postingReceipt.voucherId;
      }

      // The conservation proof, inside the same transaction after the transfer
      // posted: the sealed basis still describes the current ledger, with only
      // this owner's transfer postings and the corporate-tax effects after the
      // cutoff. Anything else refuses the close rather than sealing over it.
      const recordedAt = yield* isoNow(transaction);
      const transferId = newId("close_transfer");
      const transferOrdinal = priorTransfers.length + 1;
      const openingId = newId("opening_set");
      const certificateId = newId("close_certificate");

      const openings = yield* Db.readOpeningSetsForYear(
        transaction,
        command.scope.bookId,
        proposal.fiscalYearId,
      );

      const openingVersion = openings.length + 1;
      const supersedes = openings[openings.length - 1];

      const transferBody = {
        id: transferId,
        scope: command.scope,
        certificateId,
        fiscalYearId: proposal.fiscalYearId,
        ordinal: transferOrdinal,
        deltaMinor: delta,
        voucherId: transferVoucherId,
        proposalId: proposal.id,
        createdAt: recordedAt,
        receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
      };

      const transfer = {
        ...transferBody,
        digest: yield* digest(transferBody),
      };

      const openingBody = {
        id: openingId,
        scope: command.scope,
        version: openingVersion,
        fiscalYearId: proposal.fiscalYearId,
        certificateId,
        basisSnapshotId: retained.snapshot.id,
        supersedesId: supersedes?.id ?? null,
        transferDeltaMinor: delta,
        sourceBoundary: (yield* Ledger.readBook(
          transaction,
          command.scope,
        ))[0]!.committedSequence.toString(),
        rows: proposal.openingTarget,
        createdAt: recordedAt,
        receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
      };

      const opening = {
        ...openingBody,
        digest: yield* digest(openingBody),
      };

      const locked = yield* Db.setYearPeriodLocks(
        transaction,
        command.scope.bookId,
        proposal.fiscalYearId,
        true,
      );

      if (locked.length === 0) return yield* failure("InvalidJournal");

      const lockedPeriodIds = locked.map((period) => period.id);

      const certificateBody = {
        id: certificateId,
        scope: command.scope,
        version: 1,
        proposalId: proposal.id,
        proposalDigest: proposal.digest,
        approvalId: approval.id,
        fiscalYearId: proposal.fiscalYearId,
        transferDeltaMinor: delta,
        transferVoucherId,
        openingSetId: openingId,
        lockedPeriodIds,
        evidence: preparation.evidence,
        createdAt: recordedAt,
        receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
      };

      const certificate = yield* decode(CertificateSchema, {
        ...certificateBody,
        digest: yield* digest(certificateBody),
      });

      yield* Db.insertTransfer(transaction, {
        bookId: command.scope.bookId,
        id: transferId,
        fiscalYearId: proposal.fiscalYearId,
        ordinal: transferOrdinal,
        deltaMinor: delta,
        voucherId: transferVoucherId,
        body: yield* toJsonObject(transfer),
        digest: transfer.digest,
        recordedAt,
      });

      if (
        !(yield* snapshotIsCurrent(
          transaction,
          command.scope,
          retained.snapshot,
          proposal.fiscalYearId,
        ))
      )
        return yield* failure("StaleDependency");

      const raw = yield* Db.readRawYearBalances(
        transaction,
        command.scope.bookId,
        retained.snapshot.fiscalYear.startsOn,
        retained.snapshot.fiscalYear.endsOn,
      );

      const roles = new Map(
        retained.snapshot.mappingRelease.accountRoleRules.map((row) => [row.accountId, row.role]),
      );

      const finalNominal = raw
        .filter((row) => ["income", "expense"].includes(roles.get(row.accountId) ?? ""))
        .reduce((sum, row) => sum + BigInt(row.yearMinor), 0n);

      if (
        finalNominal !== 0n ||
        proposal.openingTarget.some(
          (row) =>
            BigInt(row.balanceMinor) !==
            BigInt(raw.find((balance) => balance.accountId === row.accountId)?.balanceMinor ?? "0"),
        )
      )
        return yield* failure("InvalidJournal");

      yield* Db.insertOpeningSet(transaction, {
        bookId: command.scope.bookId,
        id: openingId,
        fiscalYearId: proposal.fiscalYearId,
        version: openingVersion,
        certificateId,
        supersedesId: opening.supersedesId,
        body: yield* toJsonObject(opening),
        digest: opening.digest,
        recordedAt,
      });

      yield* Db.insertCertificate(transaction, {
        bookId: command.scope.bookId,
        id: certificateId,
        proposalId: proposal.id,
        fiscalYearId: proposal.fiscalYearId,
        openingSetId: openingId,
        transferId,
        body: yield* toJsonObject(certificate),
        digest: certificate.digest,
        recordedAt,
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        yield* toJsonObject(certificate),
      );

      return certificate;
    },
  );
});

// Preparation captures impact only. Approval and execution bind this exact
// proposal; execution enumerates consumers again under the writer barrier.
export const prepareYearReopen = Effect.fn("closing.financial-close.reopen")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly fiscalYearId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Close.PrepareYearReopen.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "prepare_financial_reopen",
      principal.actorId,
      {
        fiscalYearId: command.fiscalYearId,
        input: yield* toJsonObject(command.input),
      },
      Close.FinancialReopenProposal,
    );

    if (request.previous) return request.previous;

    yield* closeAccess(transaction, [...Db.financialCloseInserts]);

    const year = yield* readYear(transaction, command.scope.bookId, command.fiscalYearId);

    const certificateRow = (yield* Db.readCertificate(
      transaction,
      command.scope.bookId,
      command.input.certificateId,
    ))[0];

    if (certificateRow === undefined) return yield* failure("NotFound");

    const certificate = yield* decode(CertificateSchema, certificateRow.body);

    if (certificate.fiscalYearId !== year.id) return yield* failure("StaleDependency");

    if (
      (yield* Db.readReopenForCertificate(transaction, command.scope.bookId, certificate.id))[0] !==
      undefined
    ) {
      return yield* failure("AlreadyPosted");
    }

    const refusals = (yield* Db.readDownstreamConsumers(
      transaction,
      command.scope.bookId,
      certificate.id,
      year.endsOn,
    )).map((row) => row.id);

    const periods = yield* Db.lockYearPeriods(transaction, command.scope.bookId, year.id);

    const recordedAt = yield* isoNow(transaction);
    const reopenId = newId("close_reopen");

    const body = {
      id: reopenId,
      scope: command.scope,
      version: 1,
      certificateId: certificate.id,
      fiscalYearId: year.id,
      reason: command.input.reason,
      downstreamRefusals: refusals,
      periodIds: periods.map((period) => period.id),
      periodDigest: yield* digest(periods),
      createdBy: principal.actorId,
      createdAt: recordedAt,
      receipt: commandReceipt(
        command.idempotencyKey,
        "prepare_financial_reopen",
        principal.actorId,
      ),
    };

    const event = yield* decode(Close.FinancialReopenProposal, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertReopenProposal(
      transaction,
      command.scope.bookId,
      reopenId,
      certificate.id,
      yield* toJsonObject(event),
    );

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "prepare_financial_reopen",
      principal.actorId,
      yield* toJsonObject(event),
    );

    return event;
  });
});

function yearStatus(
  chain: Chain,
  fiscalYearId: string,
  scope: Scope,
): typeof Close.FinancialYearStatus.Type {
  const activeCertificate = [...chain.certificatesByProposal.values()].find(
    (certificate) => !executedReopen(chain.reopensByCertificate, certificate.id),
  );

  const reopened = [...chain.certificatesByProposal.values()].some((certificate) =>
    executedReopen(chain.reopensByCertificate, certificate.id),
  );

  if (activeCertificate !== undefined) {
    const proposalId = [...chain.certificatesByProposal.entries()].find(
      ([, certificate]) => certificate.id === activeCertificate.id,
    )?.[0];

    const preparationId =
      proposalId === undefined
        ? null
        : ([...chain.proposalsByPreparation.entries()].find(
            ([, proposal]) => proposal.id === proposalId,
          )?.[0] ?? null);

    return {
      scope,
      fiscalYearId,
      status: "closed",
      preparationId,
      proposalId: proposalId ?? null,
      certificateId: activeCertificate.id,
      reopened,
      blockers: [],
    };
  }

  const latestReopen = [...chain.reopensByCertificate.values()].reduce((latest, event) => {
    const createdAt = textField(event.body, "createdAt") ?? "";

    return createdAt > latest ? createdAt : latest;
  }, "");

  const headPreparation = chain.preparations
    .filter((preparation) => {
      if ((textField(preparation.body, "createdAt") ?? "") <= latestReopen) return false;

      const proposal = chain.proposalsByPreparation.get(preparation.id);

      return proposal === undefined || !chain.certificatesByProposal.has(proposal.id);
    })
    .at(-1);

  if (headPreparation === undefined) {
    return {
      scope,
      fiscalYearId,
      status: "open",
      preparationId: null,
      proposalId: null,
      certificateId: null,
      reopened,
      blockers: [],
    };
  }

  const headProposal = chain.proposalsByPreparation.get(headPreparation.id);

  if (headProposal === undefined) {
    return {
      scope,
      fiscalYearId,
      status: "preparing",
      preparationId: headPreparation.id,
      proposalId: null,
      certificateId: null,
      reopened,
      blockers: [],
    };
  }

  return {
    scope,
    fiscalYearId,
    status: "ready_for_finalization",
    preparationId: headPreparation.id,
    proposalId: headProposal.id,
    certificateId: null,
    reopened,
    blockers: [],
  };
}

export const getFinancialYearStatus = Effect.fn("closing.financial-close.status")(function* (
  token: string,
  command: { readonly scope: Scope; readonly fiscalYearId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* closeAccess(transaction, []);

    yield* readYear(transaction, command.scope.bookId, command.fiscalYearId);

    const chain = yield* readChain(transaction, command.scope, command.fiscalYearId);
    const status = yearStatus(chain, command.fiscalYearId, command.scope);

    if (status.status === "preparing" || status.status === "adjustments_pending") {
      const preparationRow =
        status.preparationId === null
          ? undefined
          : yield* readPreparationRow(transaction, command.scope, status.preparationId);

      if (preparationRow !== undefined) {
        const preparation = yield* decode(PreparationSchema, preparationRow.body);

        const snapshot = yield* readRetainedSnapshot(
          transaction,
          command.scope,
          preparation.statementSnapshotId,
        );

        const current = yield* snapshotIsCurrent(
          transaction,
          command.scope,
          snapshot.snapshot,
          command.fiscalYearId,
        );

        if (status.status === "preparing" && preparation.input.proposedAdjustmentRefs.length > 0) {
          return {
            ...status,
            status: "adjustments_pending" as const,
            blockers: current ? [] : ["close_basis_stale"],
          };
        }

        if (!current) {
          return { ...status, blockers: ["close_basis_stale"] };
        }
      }
    }

    if (status.status === "ready_for_finalization" && status.proposalId !== null) {
      const proposalRow = yield* readProposalRow(transaction, command.scope, status.proposalId);
      const blockers = yield* closeProposalBlockers(transaction, command.scope, proposalRow);

      if (blockers.length > 0) return { ...status, blockers: [...blockers] };
    }

    return status;
  });
});

export const getFinancialCloseCertificate = Effect.fn("closing.financial-close.getCertificate")(
  function* (token: string, command: { readonly scope: Scope; readonly certificateId: string }) {
    return yield* withBook(token, command.scope, false, function* (transaction) {
      yield* closeAccess(transaction, []);

      const row = (yield* Db.readCertificate(
        transaction,
        command.scope.bookId,
        command.certificateId,
      ))[0];

      if (row === undefined) return yield* failure("NotFound");

      return yield* decode(CertificateSchema, row.body);
    });
  },
);

export const getFinancialOpeningSet = Effect.fn("closing.financial-close.getOpeningSet")(function* (
  token: string,
  command: { readonly scope: Scope; readonly openingSetId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* closeAccess(transaction, []);

    const row = (yield* Db.readOpeningSet(
      transaction,
      command.scope.bookId,
      command.openingSetId,
    ))[0];

    if (row === undefined) return yield* failure("NotFound");

    return yield* decode(OpeningSchema, row.body);
  });
});

export const financialCloseHistory = Effect.fn("closing.financial-close.history")(function* (
  token: string,
  command: { readonly scope: Scope; readonly fiscalYearId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* closeAccess(transaction, []);

    yield* readYear(transaction, command.scope.bookId, command.fiscalYearId);

    const chain = yield* readChain(transaction, command.scope, command.fiscalYearId);

    return yield* decode(Close.FinancialCloseHistory, {
      scope: command.scope,
      fiscalYearId: command.fiscalYearId,
      complete: true,
      reopenings: (yield* Db.readReopensForYear(
        transaction,
        command.scope.bookId,
        command.fiscalYearId,
      )).map((row) => row.body),
      preparations: chain.preparations.map((preparation) => {
        const proposal = chain.proposalsByPreparation.get(preparation.id);

        const certificate =
          proposal === undefined ? undefined : chain.certificatesByProposal.get(proposal.id);

        return {
          id: preparation.id,
          digest: textField(preparation.body, "digest") ?? "",
          createdAt: textField(preparation.body, "createdAt") ?? "",
          proposalId: proposal?.id ?? null,
          certificateId: certificate?.id ?? null,
        };
      }),
    });
  });
});
