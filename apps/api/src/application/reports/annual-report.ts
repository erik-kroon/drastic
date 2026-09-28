import * as Report from "@open-erp/contracts/annual-report";
import * as Statements from "@open-erp/contracts/report-statements";
import * as CloseContract from "@open-erp/contracts/financial-close";
import {
  assembleIxbrl,
  finalizeSemanticReport,
  preparePresentation,
  type ReportFailure,
} from "@open-erp/domain/annual-report";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import * as Db from "../../db/reports/annual-report";
import * as StatementDb from "../../db/report-statements";
import * as CloseDb from "../../db/closing/financial-close";
import * as Ledger from "../../db/posting";
import { insertOutbox } from "../../db/posting";
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

const DraftSchema = Report.AnnualReportDraft;

const ApprovalSchema = Report.AnnualReportApproval;

const FinalSchema = Report.AnnualReportFinal;

const PresentationSchema = Report.ReportPresentation;

const ArtifactSchema = Report.ReportArtifact;

const ViewSchema = Report.AnnualReportView;

const HistorySchema = Report.AnnualReportHistory;

const SnapshotSchema = Statements.StatementSnapshot;

const CloseCertificateSchema = CloseContract.FinancialCloseCertificate;

type Draft = typeof Report.AnnualReportDraft.Type;

const maximumApprovals = 50;

const approvalWindowMs = 60 * 60 * 1000;

function reportAccess(transaction: Transaction, inserts: ReadonlyArray<string>) {
  return readTableAccess(transaction, [...Db.annualReportTables, "outbox"]).pipe(
    Effect.flatMap((rows) => {
      const denied = [...Db.annualReportTables, "outbox"].some((name) => {
        const access = rows.find((row) => row.tableName === name);

        return (
          access === undefined || !access.canSelect || (inserts.includes(name) && !access.canInsert)
        );
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

function refusalFor(reportFailure: ReportFailure) {
  return reportFailure.code === "UnsupportedFramework" ||
    reportFailure.code === "UnsupportedComparison"
    ? failure("UnsupportedProfile")
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

function readDraftRow(transaction: Transaction, scope: Scope, draftId: string) {
  return Db.readDraft(transaction, scope.bookId, draftId).pipe(
    Effect.flatMap((rows) => {
      const draft = rows[0];

      return draft ? Effect.succeed(draft) : failure("NotFound");
    }),
  );
}

function readSnapshot(
  transaction: Transaction,
  scope: Scope,
  snapshotId: string,
  fiscalYearId: string | null,
) {
  return Effect.gen(function* () {
    const header = (yield* StatementDb.readStatementSnapshot(
      transaction,
      scope.bookId,
      snapshotId,
    ))[0];

    if (header === undefined) return yield* failure("NotFound");

    const snapshot = yield* decode(SnapshotSchema, header.body);

    if (snapshot.scope.bookId !== scope.bookId) return yield* failure("StaleDependency");

    if (fiscalYearId !== null && snapshot.fiscalYear.id !== fiscalYearId) {
      return yield* failure("StaleDependency");
    }

    return snapshot;
  });
}

function readActiveCertificate(transaction: Transaction, scope: Scope, certificateId: string) {
  return Effect.gen(function* () {
    const row = (yield* CloseDb.readCertificate(transaction, scope.bookId, certificateId))[0];

    if (row === undefined) return yield* failure("NotFound");

    const certificate = yield* decode(CloseCertificateSchema, row.body);

    const reopen = (yield* CloseDb.readReopenForCertificate(
      transaction,
      scope.bookId,
      certificate.id,
    ))[0];

    if (reopen !== undefined) return yield* failure("StaleDependency");

    return certificate;
  });
}

export const prepareAnnualReport = Effect.fn("reports.annual-report.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Report.PrepareAnnualReport.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* reportAccess(transaction, [...Db.annualReportInserts]);

    const book = (yield* Ledger.readBook(transaction, command.scope))[0];

    if (!book) return yield* failure("Forbidden");

    if (book.profile !== "synthetic-core-v1" || book.authority !== "native") {
      return yield* unsupported();
    }

    if (book.currency !== "SEK") return yield* unsupported();

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "prepare_annual_report",
      principal.actorId,
      yield* toJsonObject(command.input),
      DraftSchema,
    );

    if (request.previous) return request.previous;

    const year = yield* readYear(transaction, command.scope.bookId, command.input.fiscalYearId);

    const certificate = yield* readActiveCertificate(
      transaction,
      command.scope,
      command.input.closeCertificateId,
    );

    if (certificate.fiscalYearId !== year.id) return yield* failure("StaleDependency");

    for (const snapshotId of command.input.statementSnapshotIds) {
      yield* readSnapshot(transaction, command.scope, snapshotId, year.id);
    }

    for (const snapshotId of command.input.comparativeSnapshotIds) {
      yield* readSnapshot(transaction, command.scope, snapshotId, null);
    }

    if (
      command.input.comparativeSnapshotIds.length === 0 &&
      command.input.missingHistoryNote === null
    ) {
      return yield* failure("InvalidJournal");
    }

    const evidence = yield* readEvidenceReference(
      transaction,
      command.scope.bookId,
      command.input.eligibilityEvidenceId,
    );

    const seenRequirements = new Set<string>();

    for (const requirement of command.input.disclosures) {
      if (seenRequirements.has(requirement.requirementId)) {
        return yield* failure("InvalidJournal");
      }

      seenRequirements.add(requirement.requirementId);

      if (
        requirement.applicability === "applicable" &&
        requirement.derivedMinor === null &&
        !requirement.reviewedExplicitFact
      ) {
        continue;
      }

      if (requirement.applicability === "inapplicable" && requirement.inapplicableReason === null) {
        return yield* failure("InvalidJournal");
      }

      if (requirement.evidenceId !== null) {
        yield* readEvidenceReference(transaction, command.scope.bookId, requirement.evidenceId);
      }
    }

    const seenFacts = new Set<string>();

    for (const fact of command.input.facts) {
      if (seenFacts.has(fact.semanticId)) return yield* failure("InvalidJournal");

      seenFacts.add(fact.semanticId);

      for (const evidenceId of fact.evidenceRefs) {
        yield* readEvidenceReference(transaction, command.scope.bookId, evidenceId);
      }
    }

    const narrativesApproved = command.input.narratives.every(
      (section) => section.approvedBy !== null,
    );

    const draftId = newId("annual_draft");
    const fiscalYear = year.endsOn.slice(0, 4);

    const body = {
      id: draftId,
      scope: command.scope,
      version: 1,
      profile: command.input.profile,
      fiscalYearId: year.id,
      fiscalYear,
      input: yield* toJsonObject(command.input),
      closeCertificateId: certificate.id,
      frameworkRelease: command.input.frameworkRelease,
      requirements: command.input.disclosures.map((requirement) => ({
        requirementId: requirement.requirementId,
        applicability: requirement.applicability,
        inapplicableReason: requirement.inapplicableReason,
        derivedMinor: requirement.derivedMinor,
        reviewedExplicitFact: requirement.reviewedExplicitFact,
      })),
      facts: command.input.facts.map((fact) => ({
        semanticId: fact.semanticId,
        valueMinor: fact.valueMinor,
        notApplicable: fact.notApplicable,
        evidenceRefs: [...fact.evidenceRefs],
        calculationRefs: [...fact.calculationRefs],
      })),
      narratives: command.input.narratives.map((section) => ({ ...section })),
      narrativesApproved,
      comparativeSupported: true,
      evidence,
      createdAt: yield* isoNow(transaction),
      receipt: commandReceipt(command.idempotencyKey, "prepare_annual_report", principal.actorId),
    };

    if (!/^\d{4}$/.test(fiscalYear)) return yield* failure("InvalidJournal");

    const draft = yield* decode(DraftSchema, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertDraft(transaction, {
      bookId: command.scope.bookId,
      id: draftId,
      fiscalYearId: year.id,
      closeCertificateId: certificate.id,
      body: yield* toJsonObject(draft),
      digest: draft.digest,
      recordedAt: draft.createdAt,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      "prepare_annual_report",
      principal.actorId,
      yield* toJsonObject(draft),
    );

    return draft;
  });
});

function draftBlockers(transaction: Transaction, scope: Scope, draft: Draft) {
  return Effect.gen(function* () {
    const blockers: Array<string> = [];

    const certificate = yield* readActiveCertificate(
      transaction,
      scope,
      draft.closeCertificateId,
    ).pipe(Effect.orElseSucceed(() => null));

    if (certificate === null) {
      blockers.push("The financial-close certificate is no longer active.");
    }

    const finalized = finalizeSemanticReport(
      {
        draftId: draft.id,
        fiscalYear: draft.fiscalYear,
        frameworkRelease: draft.frameworkRelease,
        frameworkSupported: true,
        closeCertificateRef: draft.closeCertificateId,
        statementSnapshotIds: draft.input.statementSnapshotIds,
        requirements: draft.requirements,
        facts: draft.facts,
        narrativesApproved: draft.narrativesApproved,
        comparativeSupported: draft.comparativeSupported,
      },
      draft.id,
      draft.digest,
    );

    if (Result.isFailure(finalized)) {
      blockers.push(finalized.failure.code);
    }

    return blockers;
  });
}

export const approveAnnualReport = Effect.fn("reports.annual-report.approve")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly draftId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Report.ApproveAnnualReport.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* reportAccess(transaction, [...Db.annualReportInserts]);

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "approve_annual_report",
      principal.actorId,
      {
        draftId: command.draftId,
        input: yield* toJsonObject(command.input),
      },
      ApprovalSchema,
    );

    if (request.previous) return request.previous;

    const draftRow = yield* readDraftRow(transaction, command.scope, command.draftId);

    if (command.input.digest !== draftRow.body["digest"]) {
      return yield* failure("StaleDependency");
    }

    const draft = yield* decode(DraftSchema, draftRow.body);
    const blockers = yield* draftBlockers(transaction, command.scope, draft);

    if (blockers.length > 0) return yield* failure("StaleDependency");

    const ordinal =
      (yield* Db.readApprovalCount(transaction, command.scope.bookId, command.draftId))[0]!.total +
      1;

    if (ordinal > maximumApprovals) return yield* failure("InvalidJournal");

    const now = yield* isoNow(transaction);

    const body = {
      id: newId("annual_approval"),
      scope: command.scope,
      draftId: command.draftId,
      digest: command.input.digest,
      version: 1,
      actorId: principal.actorId,
      ordinal,
      expiresAt: new Date(Date.parse(now) + approvalWindowMs).toISOString(),
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, "approve_annual_report", principal.actorId),
    };

    const approval = yield* decode(ApprovalSchema, body);

    yield* Db.insertApproval(transaction, {
      bookId: command.scope.bookId,
      id: approval.id,
      draftId: command.draftId,
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
      "approve_annual_report",
      principal.actorId,
      yield* toJsonObject(approval),
    );

    return approval;
  });
});

export const finalizeAnnualReport = Effect.fn("reports.annual-report.finalize")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly draftId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Report.FinalizeAnnualReport.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "finalize_annual_report";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      { draftId: command.draftId, input: yield* toJsonObject(command.input) },
      FinalSchema,
    );

    if (request.previous) return request.previous;

    yield* reportAccess(transaction, [...Db.annualReportInserts]);

    const draftRow = yield* readDraftRow(transaction, command.scope, command.draftId);
    const draft = yield* decode(DraftSchema, draftRow.body);

    if (draft.digest !== command.input.digest) return yield* failure("StaleDependency");

    if (
      (yield* Db.readFinalByDraft(transaction, command.scope.bookId, draft.id))[0] !== undefined
    ) {
      return yield* failure("AlreadyPosted");
    }

    const blockers = yield* draftBlockers(transaction, command.scope, draft);

    if (blockers.some((blocker) => blocker.includes("certificate"))) {
      return yield* failure("StaleDependency");
    }

    if (blockers.length > 0) return yield* failure("InvalidJournal");

    const approval = (yield* Db.readApprovalById(
      transaction,
      command.scope.bookId,
      command.input.approvalId,
      draft.id,
    ))[0];

    const now = yield* isoNow(transaction);

    if (
      approval === undefined ||
      approval.digest !== draft.digest ||
      Date.parse(approval.expiresAt) <= Date.parse(now)
    ) {
      return yield* failure("ApprovalRequired");
    }

    // Four-eyes separation: the operator who approved the draft may not be
    // the operator who finalizes it.
    if (approval.actorId === principal.actorId) {
      return yield* failure("ApprovalRequired");
    }

    const reportId = newId("annual_report");

    const finalized = finalizeSemanticReport(
      {
        draftId: draft.id,
        fiscalYear: draft.fiscalYear,
        frameworkRelease: draft.frameworkRelease,
        frameworkSupported: true,
        closeCertificateRef: draft.closeCertificateId,
        statementSnapshotIds: draft.input.statementSnapshotIds,
        requirements: draft.requirements,
        facts: draft.facts,
        narrativesApproved: draft.narrativesApproved,
        comparativeSupported: draft.comparativeSupported,
      },
      reportId,
      draft.digest,
    );

    if (Result.isFailure(finalized)) return yield* refusalFor(finalized.failure);

    const body = {
      id: reportId,
      scope: command.scope,
      version: 1,
      draftId: draft.id,
      draftDigest: draft.digest,
      approvalId: approval.id,
      fiscalYearId: draft.fiscalYearId,
      summary: finalized.success,
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
    };

    const final = yield* decode(FinalSchema, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertFinal(transaction, {
      bookId: command.scope.bookId,
      id: reportId,
      draftId: draft.id,
      approvalId: approval.id,
      fiscalYearId: draft.fiscalYearId,
      body: yield* toJsonObject(final),
      digest: final.digest,
      recordedAt: now,
    });

    // The render intent commits with the final semantic approval; the
    // artifact worker runs the pure assembly later through the same named
    // render operation. No journal posts here.
    yield* insertOutbox(transaction, {
      bookId: command.scope.bookId,
      id: newId("outbox"),
      receiptId: final.id,
      kind: "annual_report.render_requested.v1",
      payload: yield* toJsonObject({ reportId: final.id, modelDigest: final.summary.modelDigest }),
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(final),
    );

    return final;
  });
});

export const prepareReportPresentation = Effect.fn("reports.annual-report.presentation")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly finalId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Report.PrepareReportPresentation.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "prepare_report_presentation";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      { finalId: command.finalId, input: yield* toJsonObject(command.input) },
      PresentationSchema,
    );

    if (request.previous) return request.previous;

    yield* reportAccess(transaction, [...Db.annualReportInserts]);

    const finalRow = (yield* Db.readFinal(transaction, command.scope.bookId, command.finalId))[0];

    if (finalRow === undefined) return yield* failure("NotFound");

    const final = yield* decode(FinalSchema, finalRow.body);

    if (
      (yield* Db.readPresentationByFinal(transaction, command.scope.bookId, final.id))[0] !==
      undefined
    ) {
      return yield* failure("AlreadyPosted");
    }

    const draftRow = yield* readDraftRow(transaction, command.scope, final.draftId);
    const draft = yield* decode(DraftSchema, draftRow.body);
    const sealedFacts = new Map(draft.facts.map((fact) => [fact.semanticId, fact]));

    for (const presented of command.input.facts) {
      const sealed = sealedFacts.get(presented.semanticId);

      if (
        sealed === undefined ||
        sealed.valueMinor === null ||
        sealed.valueMinor !== presented.sourceMinor
      ) {
        return yield* failure("InvalidJournal");
      }
    }

    const presentationId = newId("annual_presentation");

    const revision = preparePresentation({
      presentationId,
      report: final.summary,
      facts: [...command.input.facts],
      expectedTotalMinor: command.input.expectedTotalMinor,
      presentationOnlyRows: [...command.input.presentationOnlyRows],
      presentationDigest: yield* digest({
        presentationId,
        finalId: final.id,
        facts: command.input.facts,
        rows: command.input.presentationOnlyRows,
      }),
    });

    if (Result.isFailure(revision)) return yield* refusalFor(revision.failure);

    const now = yield* isoNow(transaction);

    const body = {
      id: presentationId,
      scope: command.scope,
      version: 1,
      finalId: final.id,
      revision: revision.success,
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
    };

    const presentation = yield* decode(PresentationSchema, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertPresentation(transaction, {
      bookId: command.scope.bookId,
      id: presentationId,
      finalId: final.id,
      body: yield* toJsonObject(presentation),
      digest: presentation.digest,
      recordedAt: now,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(presentation),
    );

    return presentation;
  });
});

export const renderReportArtifact = Effect.fn("reports.annual-report.render")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly presentationId: string;
    readonly idempotencyKey: string;
    readonly input: typeof Report.RenderReportArtifact.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const operation = "render_report_artifact";

    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      operation,
      principal.actorId,
      { presentationId: command.presentationId, input: yield* toJsonObject(command.input) },
      ArtifactSchema,
    );

    if (request.previous) return request.previous;

    yield* reportAccess(transaction, [...Db.annualReportInserts]);

    const presentationRow = (yield* Db.readPresentation(
      transaction,
      command.scope.bookId,
      command.presentationId,
    ))[0];

    if (presentationRow === undefined) return yield* failure("NotFound");

    const presentation = yield* decode(PresentationSchema, presentationRow.body);

    if (
      (yield* Db.readArtifactByPresentation(
        transaction,
        command.scope.bookId,
        presentation.id,
      ))[0] !== undefined
    ) {
      return yield* failure("AlreadyPosted");
    }

    const finalRow = (yield* Db.readFinal(
      transaction,
      command.scope.bookId,
      presentation.finalId,
    ))[0];

    if (finalRow === undefined) return yield* failure("StaleDependency");

    const final = yield* decode(FinalSchema, finalRow.body);

    const mappings = new Map(
      command.input.conceptMappings.map((mapping) => [mapping.semanticId, mapping]),
    );

    const mappedFacts: Array<typeof Report.IxbrlFact.Type> = [];
    const unmappedConcepts: Array<string> = [];

    for (const presented of presentation.revision.facts) {
      const mapping = mappings.get(presented.semanticId);

      if (mapping === undefined) {
        unmappedConcepts.push(presented.semanticId);
        continue;
      }

      mappedFacts.push({
        concept: mapping.concept,
        contextRef: mapping.contextRef,
        unitRef: mapping.unitRef,
        valueMinor: presented.displayedMinor,
        decimals: mapping.decimals,
      });
    }

    const assembled = assembleIxbrl({
      report: final.summary,
      presentation: presentation.revision,
      mappedFacts,
      contexts: command.input.contexts.map((context) => ({
        contextRef: context.contextRef,
        entityIdentifier: command.input.entityIdentifier,
        period: context.period,
        dimensions: [...context.dimensions],
      })),
      units: [...command.input.units],
      unmappedConcepts,
    });

    if (Result.isFailure(assembled)) return yield* refusalFor(assembled.failure);

    const contentHash = yield* sha256Hex(assembled.success.xhtml);
    const sizeBytes = new TextEncoder().encode(assembled.success.xhtml).length;
    const now = yield* isoNow(transaction);
    const artifactId = newId("annual_artifact");

    const body = {
      id: artifactId,
      scope: command.scope,
      version: 1,
      presentationId: presentation.id,
      finalId: final.id,
      xhtml: assembled.success.xhtml,
      contentHash,
      mediaType: "application/xhtml+xml",
      sizeBytes,
      factCount: assembled.success.factCount,
      contextCount: assembled.success.contextCount,
      unitCount: assembled.success.unitCount,
      validationState: "pending_qualified_validator",
      signatureScopeDigest: null,
      createdAt: now,
      receipt: commandReceipt(command.idempotencyKey, operation, principal.actorId),
    };

    const artifact = yield* decode(ArtifactSchema, {
      ...body,
      digest: yield* digest(body),
    });

    yield* Db.insertArtifact(transaction, {
      bookId: command.scope.bookId,
      id: artifactId,
      presentationId: presentation.id,
      finalId: final.id,
      body: yield* toJsonObject(artifact),
      digest: artifact.digest,
      recordedAt: now,
    });

    yield* saveCommand(
      transaction,
      command.scope,
      command.idempotencyKey,
      request.expected,
      operation,
      principal.actorId,
      yield* toJsonObject(artifact),
    );

    return artifact;
  });
});

export const getAnnualReport = Effect.fn("reports.annual-report.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly draftId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* reportAccess(transaction, []);

    const draftRow = yield* readDraftRow(transaction, command.scope, command.draftId);
    const draft = yield* decode(DraftSchema, draftRow.body);
    const approval = (yield* Db.readApproval(transaction, command.scope.bookId, draft.id))[0];
    const finalRow = (yield* Db.readFinalByDraft(transaction, command.scope.bookId, draft.id))[0];

    const presentationRow =
      finalRow === undefined
        ? undefined
        : (yield* Db.readPresentationByFinal(transaction, command.scope.bookId, finalRow.id))[0];

    const artifactRow =
      presentationRow === undefined
        ? undefined
        : (yield* Db.readArtifactByPresentation(
            transaction,
            command.scope.bookId,
            presentationRow.id,
          ))[0];

    const blockers = yield* draftBlockers(transaction, command.scope, draft);
    const now = yield* isoNow(transaction);

    const usable =
      approval !== undefined &&
      approval.actorId !== principal.actorId &&
      Date.parse(approval.expiresAt) > Date.parse(now) &&
      approval.digest === draft.digest &&
      finalRow === undefined &&
      blockers.length === 0;

    return yield* decode(ViewSchema, {
      draft,
      approval: approval ? yield* decode(ApprovalSchema, approval.body) : null,
      final: finalRow ? yield* decode(FinalSchema, finalRow.body) : null,
      presentation: presentationRow
        ? yield* decode(PresentationSchema, presentationRow.body)
        : null,
      artifact: artifactRow ? yield* decode(ArtifactSchema, artifactRow.body) : null,
      blockers,
      dependenciesCurrent: blockers.length === 0,
      approvalUsable: usable,
    });
  });
});

export const annualReportHistory = Effect.fn("reports.annual-report.history")(function* (
  token: string,
  command: { readonly scope: Scope; readonly fiscalYearId: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* reportAccess(transaction, []);

    const drafts = yield* Db.readDraftsForYear(
      transaction,
      command.scope.bookId,
      command.fiscalYearId,
    );

    if (drafts.length > 50) return yield* failure("InvalidJournal");

    const items: Array<(typeof Report.AnnualReportHistory.Type)["items"][number]> = [];

    for (const draft of drafts) {
      const finalRow = (yield* Db.readFinalByDraft(transaction, command.scope.bookId, draft.id))[0];

      const artifactRow =
        finalRow === undefined
          ? undefined
          : (yield* Db.readPresentationByFinal(transaction, command.scope.bookId, finalRow.id))[0]
              ?.id;

      const artifact =
        artifactRow === undefined
          ? undefined
          : (yield* Db.readArtifactByPresentation(
              transaction,
              command.scope.bookId,
              artifactRow,
            ))[0];

      items.push({
        id: draft.id,
        digest: textFieldOf(draft.body, "digest"),
        createdAt: textFieldOf(draft.body, "createdAt"),
        finalId: finalRow?.id ?? null,
        artifactId: artifact?.id ?? null,
      });
    }

    return yield* decode(HistorySchema, {
      scope: command.scope,
      fiscalYearId: command.fiscalYearId,
      complete: true,
      count: items.length,
      items,
    });
  });
});

function textFieldOf(body: JsonObject, key: string) {
  const value = body[key];

  return typeof value === "string" ? value : "";
}
