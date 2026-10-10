import * as Documents from "@open-erp/contracts/document-signatures";
import * as Filing from "@open-erp/contracts/filing-lifecycle";
import * as Report from "@open-erp/contracts/annual-report";
import * as Close from "@open-erp/contracts/financial-close";
import { expect } from "vitest";
import { createSession, failure, post, request } from "./fixtures";
import {
  capture,
  closeApproval,
  closeFixture,
  closePath,
  controls,
  finalProposal,
  recognizeTax,
  taxBridge,
} from "./financial-close";

export const documents = "/documents";

export const filings = "/filings";

// A synthetic closed year with an approved annual report artifact, reviewed
// governance, a validated manifest and a reviewed filing adoption. The book and
// reviewer carry browser sessions; `credential` keeps the operator API credential.
export async function annualArtifact() {
  const context = await closeFixture("75000");
  const basis = await taxBridge(context);
  await recognizeTax(context, basis.bridge);
  await controls(context);
  const proposal = await finalProposal(context, basis);
  const approval = await closeApproval(context, proposal);

  const certificate = await post(
    context.book,
    `${closePath}/proposals/${proposal.id}/execute`,
    { version: 1, digest: proposal.digest, approvalId: approval.id },
    Close.FinancialCloseCertificate,
  );

  const snapshot = await capture(context.book);

  const draft = await post(
    context.book,
    "/reports/annual/drafts",
    {
      profile: "k2-annual-report-v1",
      fiscalYearId: "fy_2026",
      closeCertificateId: certificate.id,
      statementSnapshotIds: [snapshot.id],
      comparativeSnapshotIds: [],
      comparativeFacts: [],
      missingHistoryNote: "Synthetic first year",
      frameworkRelease: "K2-2026",
      eligibilityEvidenceId: context.source.id,
      disclosures: [],
      narratives: [],
      facts: [
        {
          semanticId: "assets",
          snapshotId: snapshot.id,
          rowId: "cash_total",
          notApplicable: false,
          evidenceRefs: [context.source.id],
          calculationRefs: [],
        },
      ],
      reason: "Synthetic signing vector",
    },
    Report.AnnualReportDraft,
  );

  const reportApproval = await post(
    context.reviewer,
    `/reports/annual/drafts/${draft.id}/approvals`,
    { version: 1, digest: draft.digest },
    Report.AnnualReportApproval,
  );

  const final = await post(
    context.book,
    `/reports/annual/drafts/${draft.id}/finalize`,
    { version: 1, digest: draft.digest, approvalId: reportApproval.id },
    Report.AnnualReportFinal,
  );

  const presentation = await post(
    context.book,
    `/reports/annual/finals/${final.id}/presentation`,
    {
      finalId: final.id,
      displayRule: { scale: 0, rounding: "exact" },
      totals: [{ label: "assets", memberSemanticIds: ["assets"] }],
    },
    Report.ReportPresentation,
  );

  const artifact = await post(
    context.book,
    `/reports/annual/presentations/${presentation.id}/artifact`,
    {
      presentationId: presentation.id,
      entityIdentifier: context.book.entityId,
      taxonomyRelease: "synthetic-k2-v1",
      units: ["SEK"],
      contexts: [{ contextRef: "year_end", period: "2026-12-31", dimensions: [] }],
      conceptMappings: [
        { semanticId: "assets", concept: "se:Assets", contextRef: "year_end", unitRef: "SEK" },
      ],
    },
    Report.ReportArtifact,
  );

  const operatorSession = await createSession(context.book);
  const reviewerSession = await createSession(context.reviewer);

  return {
    ...context,
    credential: context.book,
    artifact,
    draft,
    final,
    presentation,
    book: { ...context.book, token: operatorSession.token },
    reviewer: { ...context.reviewer, token: reviewerSession.token },
  };
}

export async function signingFixture() {
  const context = await annualArtifact();

  const governance = await post(
    context.book,
    `${documents}/governance`,
    {
      legalEntityRevision: "synthetic_entity_revision_1",
      fiscalYearId: "fy_2026",
      evidenceId: context.source.id,
      requiredSigners: [
        { signerId: context.book.actorId, role: "board_member" },
        { signerId: context.reviewer.actorId, role: "board_member" },
      ],
      certifierIds: [context.reviewer.actorId],
      supersedesId: null,
    },
    Documents.GovernanceRevision,
  );

  await failure(
    await request(context.book, `${documents}/governance/${governance.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({
        digest: governance.digest,
        result: "confirmed",
        reason: "Independent synthetic review",
      }),
    }),
    403,
    "Forbidden",
  );
  await post(
    context.reviewer,
    `${documents}/governance/${governance.id}/reviews`,
    { digest: governance.digest, result: "confirmed", reason: "Independent synthetic review" },
    Documents.GovernanceReview,
  );

  const validation = await post(
    context.book,
    `${documents}/validations`,
    { artifactId: context.artifact.id },
    Documents.DocumentValidation,
  );

  expect(validation.result).toBe("passed");
  expect(validation.profile).toBe("synthetic-xhtml-v1");
  expect(context.artifact.validationState).toBe("pending_qualified_validator");

  const manifest = await post(
    context.book,
    `${documents}/manifests`,
    {
      artifactId: context.artifact.id,
      validationId: validation.id,
      governanceId: governance.id,
      purpose: "annual_report_signing",
      consentText: "Sign this exact synthetic annual report",
      policyRelease: "synthetic-signature-v1",
    },
    Documents.DocumentManifest,
  );

  const adoption = await post(
    context.book,
    `${filings}/adoptions`,
    { manifestId: manifest.id, evidenceId: context.source.id, adoptedOn: "2027-02-01" },
    Filing.AdoptionRecord,
  );

  await post(
    context.reviewer,
    `${filings}/adoptions/${adoption.id}/reviews`,
    { digest: adoption.digest, reason: "Independent exact synthetic adoption" },
    Filing.AdoptionReview,
  );

  return { ...context, governance, validation, manifest, adoption };
}

export async function sign(
  context: Awaited<ReturnType<typeof signingFixture>>,
  signer = context.book,
) {
  const intent = await post(
    signer,
    `${documents}/signature-intents`,
    { manifestId: context.manifest.id, signerId: signer.actorId },
    Documents.DocumentSignatureIntent,
  );

  return post(
    signer,
    `${documents}/signature-intents/${intent.id}/start`,
    { digest: intent.digest },
    Documents.SignatureIntentView,
  );
}
