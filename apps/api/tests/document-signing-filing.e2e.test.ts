import * as Documents from "@open-erp/contracts/document-signatures";
import * as Filing from "@open-erp/contracts/filing-lifecycle";
import * as Report from "@open-erp/contracts/annual-report";
import * as Close from "@open-erp/contracts/financial-close";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createSession,
  decoded,
  environment,
  failure,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";
import {
  capture,
  closeApproval,
  closeFixture,
  closePath,
  controls,
  finalProposal,
  recognizeTax,
  taxBridge,
} from "./support/financial-close";

const documents = "/documents";

const filings = "/filings";

async function annualArtifact() {
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
    artifact,
    draft,
    final,
    presentation,
    book: { ...context.book, token: operatorSession.token },
    reviewer: { ...context.reviewer, token: reviewerSession.token },
  };
}

async function signingFixture() {
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

async function sign(context: Awaited<ReturnType<typeof signingFixture>>, signer = context.book) {
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

async function configure(correlation: string, controls: unknown) {
  const env = environment();

  const response = await fetch(
    `${env.documentFixtureUrl}/fixtures/${encodeURIComponent(correlation)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${env.documentFixtureSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(controls),
    },
  );

  expect(response.status).toBe(200);
}

test("document login gives zero signatures and exact distinct signer coverage binds the whole manifest", async () => {
  const context = await signingFixture();
  const before = await persisted(context.book);

  const initial = await decoded(
    await request(context.book, `${documents}/manifests/${context.manifest.id}`),
    Documents.SignatureManifestView,
  );

  expect(initial.signatures).toEqual([]);
  expect(initial.complete).toBe(false);
  const first = await sign(context);
  expect(first.evidence?.technicalResult).toBe("valid");

  const repeated = await post(
    context.book,
    `${documents}/signature-intents/${first.intent.id}/collect`,
    { digest: first.intent.digest },
    Documents.SignatureIntentView,
  );

  expect(repeated.evidence?.id).toBe(first.evidence?.id);

  const half = await decoded(
    await request(context.book, `${documents}/manifests/${context.manifest.id}`),
    Documents.SignatureManifestView,
  );

  expect(half.signatures).toHaveLength(1);
  expect(half.complete).toBe(false);
  const second = await sign(context, context.reviewer);
  expect(second.evidence?.technicalResult).toBe("valid");

  const complete = await decoded(
    await request(context.book, `${documents}/manifests/${context.manifest.id}`),
    Documents.SignatureManifestView,
  );

  expect(complete.complete).toBe(true);
  expect(complete.signatures).toHaveLength(2);
  expect(await persisted(context.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "document-exact-signers.json"),
    JSON.stringify({ manifest: context.manifest, initial, first, repeated, complete }, null, 2),
  );
}, 120000);

test("lost signing response recovers one order and changed replay input refuses", async () => {
  const context = await signingFixture();

  const intent = await post(
    context.book,
    `${documents}/signature-intents`,
    { manifestId: context.manifest.id, signerId: context.book.actorId },
    Documents.DocumentSignatureIntent,
  );

  await configure(intent.correlation, { loseStart: true });
  const replayKey = key();

  const start = () =>
    request(context.book, `${documents}/signature-intents/${intent.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": replayKey },
      body: JSON.stringify({ digest: intent.digest }),
    });

  const unknown = await decoded(await start(), Documents.SignatureIntentView);
  expect(unknown.state).toBe("start_unknown");
  const recovered = await decoded(await start(), Documents.SignatureIntentView);
  expect(recovered.state).toBe("complete");
  expect(recovered.attempt?.id).toBe(unknown.attempt?.id);
  expect(recovered.evidence?.technicalResult).toBe("valid");
  await failure(
    await request(context.book, `${documents}/signature-intents/${intent.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": replayKey },
      body: JSON.stringify({ digest: `sha256:${"0".repeat(64)}` }),
    }),
    409,
    "IdempotencyConflict",
  );
  await writeFile(
    join(environment().artifacts, "document-unknown-recovery.json"),
    JSON.stringify({ unknown, recovered }, null, 2),
  );
}, 120000);

test.each([
  "bad_signature",
  "wrong_digest",
  "wrong_signer",
  "wrong_order",
  "wrong_environment",
  "wrong_key",
])(
  "authentic transport retains %s without signature eligibility",
  async (defect) => {
    const context = await signingFixture();

    const intent = await post(
      context.book,
      `${documents}/signature-intents`,
      { manifestId: context.manifest.id, signerId: context.book.actorId },
      Documents.DocumentSignatureIntent,
    );

    await configure(intent.correlation, { defect });

    const result = await post(
      context.book,
      `${documents}/signature-intents/${intent.id}/start`,
      { digest: intent.digest },
      Documents.SignatureIntentView,
    );

    expect(result.state).toBe("invalid");
    expect(result.evidence?.technicalResult).toBe("invalid");
    expect(result.evidence?.usageEligibility).toBe("ineligible");

    const manifest = await decoded(
      await request(context.book, `${documents}/manifests/${context.manifest.id}`),
      Documents.SignatureManifestView,
    );

    expect(manifest.complete).toBe(false);
    await writeFile(
      join(environment().artifacts, `document-${defect}.json`),
      JSON.stringify(result, null, 2),
    );
  },
  120000,
);

test("revoked governance retains technical signature and refuses future filing, agents cannot sign", async () => {
  const context = await signingFixture();
  const first = await sign(context);
  await sign(context, context.reviewer);
  await failure(
    await request(context.book, `${documents}/signature-intents`, {
      method: "POST",
      headers: { authorization: `Bearer ${context.book.agentToken}` },
      body: JSON.stringify({ manifestId: context.manifest.id, signerId: context.book.actorId }),
    }),
    403,
    "Forbidden",
  );
  await post(
    context.reviewer,
    `${documents}/governance/${context.governance.id}/reviews`,
    { digest: context.governance.digest, result: "revoked", reason: "Synthetic role revocation" },
    Documents.GovernanceReview,
  );

  const view = await decoded(
    await request(context.book, `${documents}/signature-intents/${first.intent.id}`),
    Documents.SignatureIntentView,
  );

  expect(view.evidence?.technicalResult).toBe("valid");
  expect(view.eligibleNow).toBe(false);
  await failure(
    await request(context.book, `${filings}/intents`, {
      method: "POST",
      body: JSON.stringify({
        manifestId: context.manifest.id,
        copyArtifactId: context.artifact.id,
        copyValidationId: context.validation.id,
        adoptionId: context.adoption.id,
        governanceId: context.governance.id,
        certifierId: context.reviewer.actorId,
        requiredOutcome: "registered",
        predecessorIntentId: null,
      }),
    }),
    409,
    "StaleDependency",
  );
}, 120000);

test("filing upload and received stay unfulfilled, separate eligible certification precedes matching registration", async () => {
  const context = await signingFixture();
  await sign(context);
  await sign(context, context.reviewer);
  const before = await persisted(context.book);

  const input = {
    manifestId: context.manifest.id,
    copyArtifactId: context.artifact.id,
    copyValidationId: context.validation.id,
    adoptionId: context.adoption.id,
    governanceId: context.governance.id,
    certifierId: context.reviewer.actorId,
    requiredOutcome: "registered",
    predecessorIntentId: null,
  };

  const intent = await post(context.book, `${filings}/intents`, input, Filing.FilingIntent);
  await failure(
    await request(context.book, `${filings}/intents/${intent.id}/upload`, {
      method: "POST",
      body: JSON.stringify({ digest: intent.digest }),
    }),
    403,
    "Forbidden",
  );
  await post(
    context.book,
    `${filings}/intents/${intent.id}/authorizations`,
    { digest: intent.digest },
    Filing.FilingAuthorization,
  );
  await configure(intent.correlation, { loseUpload: true });

  const unknown = await post(
    context.book,
    `${filings}/intents/${intent.id}/upload`,
    { digest: intent.digest },
    Filing.FilingView,
  );

  expect(unknown.state).toBe("upload_outcome_unknown");

  const uploaded = await post(
    context.book,
    `${filings}/intents/${intent.id}/upload`,
    { digest: intent.digest },
    Filing.FilingView,
  );

  expect(uploaded.state).toBe("awaiting_authority_certification");
  expect(uploaded.fulfilled).toBe(false);
  expect(uploaded.attempt?.id).toBe(unknown.attempt?.id);
  await failure(
    await request(context.book, `${filings}/intents/${intent.id}/certify`, {
      method: "POST",
      body: JSON.stringify({ digest: intent.digest }),
    }),
    403,
    "Forbidden",
  );

  const submitted = await post(
    context.reviewer,
    `${filings}/intents/${intent.id}/certify`,
    { digest: intent.digest },
    Filing.FilingView,
  );

  expect(submitted.state).toBe("submitted_pending");
  expect(submitted.fulfilled).toBe(false);
  await configure(intent.correlation, { status: "received" });

  const received = await post(
    context.book,
    `${filings}/intents/${intent.id}/collect`,
    { digest: intent.digest },
    Filing.FilingView,
  );

  expect(received.state).toBe("received");
  expect(received.fulfilled).toBe(false);
  await configure(intent.correlation, { status: "registered" });

  const registered = await post(
    context.book,
    `${filings}/intents/${intent.id}/collect`,
    { digest: intent.digest },
    Filing.FilingView,
  );

  expect(registered.state).toBe("registered_if_required");
  expect(registered.fulfilled).toBe(true);

  await configure(intent.correlation, { status: "registered", loseCollect: true });

  const transportLost = await post(
    context.book,
    `${filings}/intents/${intent.id}/collect`,
    { digest: intent.digest },
    Filing.FilingView,
  );

  expect(transportLost.state).toBe("registered_if_required");
  expect(transportLost.fulfilled).toBe(true);
  expect(transportLost.observations.at(-1)?.technicalVerified).toBe(false);

  const replayed = await post(
    context.book,
    `${filings}/intents/${intent.id}/collect`,
    { digest: intent.digest },
    Filing.FilingView,
  );

  expect(replayed.observations).toHaveLength(transportLost.observations.length + 1);
  expect(replayed.fulfilled).toBe(true);
  await failure(
    await request(context.book, `${filings}/intents`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    409,
    "AlreadyPosted",
  );
  const service = await retentionService(context);
  await post(
    context.reviewer,
    `${documents}/governance/${context.governance.id}/reviews`,
    {
      digest: context.governance.digest,
      result: "revoked",
      reason: "Synthetic certifier eligibility ends after actual registration",
    },
    Documents.GovernanceReview,
  );

  const serviceRetained = await post(
    service,
    `${filings}/intents/${intent.id}/retain`,
    { digest: intent.digest },
    Filing.FilingView,
  );

  expect(serviceRetained.state).toBe("registered_if_required");
  expect(serviceRetained.fulfilled).toBe(true);
  expect(serviceRetained.eligibleNow).toBe(false);
  expect(serviceRetained.attempt?.id).toBe(registered.attempt?.id);

  for (const action of ["upload", "certify"]) {
    await failure(
      await request(service, `${filings}/intents/${intent.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ digest: intent.digest }),
      }),
      403,
      "Forbidden",
    );
  }

  expect(await persisted(context.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "filing-finite-registration.json"),
    JSON.stringify(
      {
        intent,
        unknown,
        uploaded,
        submitted,
        received,
        registered,
        transportLost,
        replayed,
        serviceRetained,
      },
      null,
      2,
    ),
  );
}, 120000);

test.each(["wrong_entity", "wrong_year", "wrong_artifact", "wrong_attempt", "unsupported_status"])(
  "filing %s stays quarantined or needs review",
  async (defect) => {
    const context = await signingFixture();
    await sign(context);
    await sign(context, context.reviewer);

    const intent = await post(
      context.book,
      `${filings}/intents`,
      {
        manifestId: context.manifest.id,
        copyArtifactId: context.artifact.id,
        copyValidationId: context.validation.id,
        adoptionId: context.adoption.id,
        governanceId: context.governance.id,
        certifierId: context.reviewer.actorId,
        requiredOutcome: "registered",
        predecessorIntentId: null,
      },
      Filing.FilingIntent,
    );

    await post(
      context.book,
      `${filings}/intents/${intent.id}/authorizations`,
      { digest: intent.digest },
      Filing.FilingAuthorization,
    );
    await post(
      context.book,
      `${filings}/intents/${intent.id}/upload`,
      { digest: intent.digest },
      Filing.FilingView,
    );
    await post(
      context.reviewer,
      `${filings}/intents/${intent.id}/certify`,
      { digest: intent.digest },
      Filing.FilingView,
    );
    await configure(intent.correlation, { status: "registered", defect });

    const result = await post(
      context.book,
      `${filings}/intents/${intent.id}/collect`,
      { digest: intent.digest },
      Filing.FilingView,
    );

    expect(result.state).toBe("needs_review");
    expect(result.fulfilled).toBe(false);
    expect(result.observations.at(-1)?.quarantined).toBe(defect !== "unsupported_status");
    await writeFile(
      join(environment().artifacts, `filing-${defect}.json`),
      JSON.stringify(result, null, 2),
    );
  },
  120000,
);

test("completed signing binds every replay key and concurrent starts retain one economic order", async () => {
  const context = await signingFixture();

  const intent = await post(
    context.book,
    `${documents}/signature-intents`,
    { manifestId: context.manifest.id, signerId: context.book.actorId },
    Documents.DocumentSignatureIntent,
  );

  const starts = await Promise.all([
    post(
      context.book,
      `${documents}/signature-intents/${intent.id}/start`,
      { digest: intent.digest },
      Documents.SignatureIntentView,
    ),
    post(
      context.book,
      `${documents}/signature-intents/${intent.id}/start`,
      { digest: intent.digest },
      Documents.SignatureIntentView,
    ),
  ]);

  expect(starts[0]?.evidence?.technicalResult).toBe("valid");
  expect(starts[0]?.evidence?.id).toBe(starts[1]?.evidence?.id);
  const replayKey = key();

  const completed = await decoded(
    await request(context.book, `${documents}/signature-intents/${intent.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": replayKey },
      body: JSON.stringify({ digest: intent.digest }),
    }),
    Documents.SignatureIntentView,
  );

  expect(completed.evidence?.id).toBe(starts[0]?.evidence?.id);
  await failure(
    await request(context.book, `${documents}/signature-intents/${intent.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": replayKey },
      body: JSON.stringify({ digest: `sha256:${"0".repeat(64)}` }),
    }),
    409,
    "IdempotencyConflict",
  );
  const env = environment();

  const inspected = await fetch(`${env.documentFixtureUrl}/inspect/${intent.correlation}`, {
    headers: { authorization: `Bearer ${env.documentFixtureSecret}` },
  });

  expect(inspected.status).toBe(200);
  expect(await inspected.json()).toEqual({ signatureOrders: 1, filingUploads: 0 });
  await writeFile(
    join(env.artifacts, "document-concurrent-starts.json"),
    JSON.stringify({ starts, completed }, null, 2),
  );
}, 120000);

test("signature publication rollback preserves admitted identity and exact recovery", async () => {
  const context = await signingFixture();

  const intent = await post(
    context.book,
    `${documents}/signature-intents`,
    { manifestId: context.manifest.id, signerId: context.book.actorId },
    Documents.DocumentSignatureIntent,
  );

  const admin = await import("./support/fixtures").then((module) => module.database());

  try {
    await admin.query(
      "create function openerp.e2e_document_publication_fault() returns trigger language plpgsql as $$ begin if NEW.book_id=TG_ARGV[0] then raise exception using errcode='23514',message='Synthetic publication fault'; end if; return NEW; end $$",
    );
    await admin.query(
      `create trigger e2e_document_publication_fault before insert on openerp.document_signature_observations for each row execute function openerp.e2e_document_publication_fault('${context.book.bookId}')`,
    );
    const replayKey = key();

    const start = () =>
      request(context.book, `${documents}/signature-intents/${intent.id}/start`, {
        method: "POST",
        headers: { "idempotency-key": replayKey },
        body: JSON.stringify({ digest: intent.digest }),
      });

    await failure(await start(), 500, "InternalError");

    const rolledBack = await decoded(
      await request(context.book, `${documents}/signature-intents/${intent.id}`),
      Documents.SignatureIntentView,
    );

    expect(rolledBack.evidence).toBeNull();
    expect(rolledBack.observations).toEqual([]);
    expect(rolledBack.attempt?.correlation).toBe(intent.correlation);
    await admin.query(
      "drop trigger e2e_document_publication_fault on openerp.document_signature_observations",
    );
    await admin.query("drop function openerp.e2e_document_publication_fault()");
    const recovered = await decoded(await start(), Documents.SignatureIntentView);
    expect(recovered.evidence?.technicalResult).toBe("valid");
    expect(recovered.attempt?.id).toBe(rolledBack.attempt?.id);
    expect(recovered.observations).toHaveLength(1);
    await writeFile(
      join(environment().artifacts, "document-atomic-publication.json"),
      JSON.stringify({ rolledBack, recovered }, null, 2),
    );
  } finally {
    await admin.query(
      "drop trigger if exists e2e_document_publication_fault on openerp.document_signature_observations",
    );
    await admin.query("drop function if exists openerp.e2e_document_publication_fault()");
    await admin.end();
  }
}, 120000);

test("cross-book and ordinary-agent callers cannot acquire human document authority", async () => {
  const context = await signingFixture();
  const first = await sign(context);
  await failure(
    await request(context.other, `${documents}/manifests/${context.manifest.id}`),
    404,
    "NotFound",
  );
  await failure(
    await request(context.book, `${documents}/governance/${context.governance.id}/reviews`, {
      method: "POST",
      headers: { authorization: `Bearer ${context.book.agentToken}` },
      body: JSON.stringify({
        digest: context.governance.digest,
        result: "confirmed",
        reason: "Agent cannot review governance",
      }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(context.reviewer, `${documents}/signature-intents/${first.intent.id}/start`, {
      method: "POST",
      body: JSON.stringify({ digest: first.intent.digest }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(context.book, `${filings}/intents`, {
      method: "POST",
      body: JSON.stringify({
        manifestId: context.manifest.id,
        copyArtifactId: context.artifact.id,
        copyValidationId: context.validation.id,
        adoptionId: context.adoption.id,
        governanceId: context.governance.id,
        certifierId: context.reviewer.actorId,
        requiredOutcome: "registered",
        predecessorIntentId: null,
      }),
    }),
    409,
    "StaleDependency",
  );
}, 120000);

async function retentionService(context: Awaited<ReturnType<typeof signingFixture>>) {
  const { database } = await import("./support/fixtures");
  const { createHash } = await import("node:crypto");
  const admin = await database();
  const token = environment().documentFixtureServiceToken;

  try {
    await admin.query(
      "insert into openerp.actors(id,name) values('document_retention_service','Synthetic retention service') on conflict(id) do nothing",
    );
    await admin.query(
      "insert into openerp.credentials(token_hash,actor_id,expires_at) values($1,'document_retention_service',now()+interval '1 day') on conflict(token_hash) do nothing",
      [createHash("sha256").update(token).digest("hex")],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,'document_retention_service','agent') on conflict(book_id,actor_id) do nothing",
      [context.book.bookId],
    );
  } finally {
    await admin.end();
  }

  return { ...context.book, token, actorId: "document_retention_service" };
}

test("private evidence grant refusal creates no signing attempt and exact retry completes once", async () => {
  const context = await signingFixture();
  const before = await persisted(context.book);

  const intent = await post(
    context.book,
    `${documents}/signature-intents`,
    { manifestId: context.manifest.id, signerId: context.book.actorId },
    Documents.DocumentSignatureIntent,
  );

  const { database } = await import("./support/fixtures");
  const admin = await database();
  const requestKey = key();
  let refused: typeof Documents.SignatureIntentView.Type;

  try {
    await admin.query("revoke insert on openerp.document_signature_evidence from openerp_runtime");
    await failure(
      await request(context.book, `${documents}/signature-intents/${intent.id}/start`, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey },
        body: JSON.stringify({ digest: intent.digest }),
      }),
      422,
      "UnsupportedProfile",
    );
    refused = await decoded(
      await request(context.book, `${documents}/signature-intents/${intent.id}`),
      Documents.SignatureIntentView,
    );
    expect(refused.state).toBe("prepared");
    expect(refused.attempt).toBe(null);
    expect(refused.evidence).toBe(null);
    const env = environment();

    const inspected = await fetch(`${env.documentFixtureUrl}/inspect/${intent.correlation}`, {
      headers: { authorization: `Bearer ${env.documentFixtureSecret}` },
    });

    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toEqual({ signatureOrders: 0, filingUploads: 0 });
  } finally {
    await admin.query("grant insert on openerp.document_signature_evidence to openerp_runtime");
    await admin.end();
  }

  const start = () =>
    request(context.book, `${documents}/signature-intents/${intent.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ digest: intent.digest }),
    });

  const completed = await decoded(await start(), Documents.SignatureIntentView);
  const replayed = await decoded(await start(), Documents.SignatureIntentView);
  expect(completed.state).toBe("complete");
  expect(completed.evidence?.technicalResult).toBe("valid");
  expect(replayed.evidence?.id).toBe(completed.evidence?.id);
  expect(replayed.observations).toHaveLength(1);
  expect(await persisted(context.book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "document-private-evidence-grant.json"),
    JSON.stringify({ refused, completed, replayed }, null, 2),
  );
}, 120000);

test("retention service collects an admitted revoked signer without fresh human authority", async () => {
  const context = await signingFixture();

  const intent = await post(
    context.book,
    `${documents}/signature-intents`,
    { manifestId: context.manifest.id, signerId: context.book.actorId },
    Documents.DocumentSignatureIntent,
  );

  await configure(intent.correlation, { loseStart: true });

  const unknown = await post(
    context.book,
    `${documents}/signature-intents/${intent.id}/start`,
    { digest: intent.digest },
    Documents.SignatureIntentView,
  );

  expect(unknown.state).toBe("start_unknown");
  const service = await retentionService(context);
  const { database } = await import("./support/fixtures");
  const admin = await database();

  try {
    await admin.query("update openerp.identity_admissions set enabled=false where actor_id=$1", [
      context.book.actorId,
    ]);
  } finally {
    await admin.end();
  }

  const retained = await post(
    service,
    `${documents}/signature-intents/${intent.id}/retain`,
    { digest: intent.digest },
    Documents.SignatureIntentView,
  );

  expect(retained.evidence?.technicalResult).toBe("valid");
  expect(retained.evidence?.usageEligibility).toBe("ineligible");
  expect(retained.eligibleNow).toBe(false);
  expect(retained.attempt?.id).toBe(unknown.attempt?.id);
  await failure(
    await request(service, `${documents}/signature-intents/${intent.id}/start`, {
      method: "POST",
      body: JSON.stringify({ digest: intent.digest }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(
      { ...context.reviewer, token: context.book.agentToken },
      `${documents}/signature-intents/${intent.id}/retain`,
      { method: "POST", body: JSON.stringify({ digest: intent.digest }) },
    ),
    403,
    "Forbidden",
  );
  await failure(
    await request(
      { ...context.other, token: service.token },
      `${documents}/signature-intents/${intent.id}/retain`,
      { method: "POST", body: JSON.stringify({ digest: intent.digest }) },
    ),
    403,
    "Forbidden",
  );

  const readable = await decoded(
    await request(context.reviewer, `${documents}/signature-intents/${intent.id}`),
    Documents.SignatureIntentView,
  );

  expect(readable.evidence?.id).toBe(retained.evidence?.id);
  await writeFile(
    join(environment().artifacts, "document-service-retention.json"),
    JSON.stringify({ unknown, retained, readable }, null, 2),
  );
}, 120000);

test("reconfirmed governance restores current coverage without rewriting technical history", async () => {
  const context = await signingFixture();

  const intent = await post(
    context.book,
    `${documents}/signature-intents`,
    { manifestId: context.manifest.id, signerId: context.book.actorId },
    Documents.DocumentSignatureIntent,
  );

  await configure(intent.correlation, { loseStart: true });

  const unknown = await post(
    context.book,
    `${documents}/signature-intents/${intent.id}/start`,
    { digest: intent.digest },
    Documents.SignatureIntentView,
  );

  expect(unknown.state).toBe("start_unknown");
  await post(
    context.reviewer,
    `${documents}/governance/${context.governance.id}/reviews`,
    {
      digest: context.governance.digest,
      result: "revoked",
      reason: "Synthetic authority revoked before collection",
    },
    Documents.GovernanceReview,
  );

  const service = await retentionService(context);

  const retired = await post(
    service,
    `${documents}/signature-intents/${intent.id}/retain`,
    { digest: intent.digest },
    Documents.SignatureIntentView,
  );

  expect(retired.evidence?.technicalResult).toBe("valid");
  expect(retired.evidence?.usageEligibility).toBe("ineligible");
  expect(retired.eligibleNow).toBe(false);
  await post(
    context.reviewer,
    `${documents}/governance/${context.governance.id}/reviews`,
    {
      digest: context.governance.digest,
      result: "confirmed",
      reason: "Synthetic exact governance independently reconfirmed",
    },
    Documents.GovernanceReview,
  );

  const current = await decoded(
    await request(context.book, `${documents}/signature-intents/${intent.id}`),
    Documents.SignatureIntentView,
  );

  expect(current.eligibleNow).toBe(true);
  expect(current.evidence).toEqual(retired.evidence);
  const second = await sign(context, context.reviewer);
  expect(second.evidence?.technicalResult).toBe("valid");

  const coverage = await decoded(
    await request(context.book, `${documents}/manifests/${context.manifest.id}`),
    Documents.SignatureManifestView,
  );

  expect(coverage.complete).toBe(true);
  expect(coverage.missingSignerIds).toEqual([]);
  expect(coverage.signatures).toHaveLength(2);
  expect(
    coverage.signatures.find((evidence) => evidence.id === retired.evidence?.id)?.usageEligibility,
  ).toBe("ineligible");

  const filing = await post(
    context.book,
    `${filings}/intents`,
    {
      manifestId: context.manifest.id,
      copyArtifactId: context.artifact.id,
      copyValidationId: context.validation.id,
      adoptionId: context.adoption.id,
      governanceId: context.governance.id,
      certifierId: context.reviewer.actorId,
      requiredOutcome: "registered",
      predecessorIntentId: null,
    },
    Filing.FilingIntent,
  );

  expect(filing.signatureEvidenceIds).toContain(retired.evidence?.id);
  expect(filing.signatureEvidenceIds).toHaveLength(2);
  await writeFile(
    join(environment().artifacts, "document-reconfirmed-current-eligibility.json"),
    JSON.stringify({ unknown, retired, current, second, coverage, filing }, null, 2),
  );
}, 120000);

test("oversized authenticated response is refused before body completion and exact correlation recovers once", async () => {
  const context = await signingFixture();

  const intent = await post(
    context.book,
    `${documents}/signature-intents`,
    { manifestId: context.manifest.id, signerId: context.book.actorId },
    Documents.DocumentSignatureIntent,
  );

  await configure(intent.correlation, { oversizedResponse: true });
  const requestKey = key();

  const start = () =>
    request(context.book, `${documents}/signature-intents/${intent.id}/start`, {
      method: "POST",
      headers: { "idempotency-key": requestKey },
      body: JSON.stringify({ digest: intent.digest }),
    });

  const unknown = await decoded(await start(), Documents.SignatureIntentView);

  expect(unknown.state).toBe("start_unknown");
  expect(unknown.evidence).toBe(null);
  expect(unknown.attempt?.correlation).toBe(intent.correlation);
  const env = environment();

  const observationSchema = Schema.Struct({
    state: Schema.Literals(["not_started", "streaming", "cancelled", "complete"]),
    bytesSent: Schema.Number,
  });

  const response = await fetch(`${env.documentFixtureUrl}/response-inspect/${intent.correlation}`, {
    headers: { authorization: `Bearer ${env.documentFixtureSecret}` },
  });

  expect(response.status).toBe(200);
  const stream = Schema.decodeSync(Schema.fromJsonString(observationSchema))(await response.text());

  await writeFile(
    join(env.artifacts, "document-response-bound-diagnostic.json"),
    JSON.stringify({ stream, unknown }, null, 2),
  );

  expect(["streaming", "cancelled"]).toContain(stream.state);
  expect(stream.bytesSent).toBeGreaterThan(65536);
  expect(stream.bytesSent).toBeLessThan(1048576);
  const recovered = await decoded(await start(), Documents.SignatureIntentView);
  const replayed = await decoded(await start(), Documents.SignatureIntentView);

  expect(recovered.state).toBe("complete");
  expect(recovered.evidence?.technicalResult).toBe("valid");
  expect(recovered.attempt?.id).toBe(unknown.attempt?.id);
  expect(replayed.evidence?.id).toBe(recovered.evidence?.id);

  const inspected = await fetch(`${env.documentFixtureUrl}/inspect/${intent.correlation}`, {
    headers: { authorization: `Bearer ${env.documentFixtureSecret}` },
  });

  expect(inspected.status).toBe(200);
  expect(await inspected.json()).toEqual({ signatureOrders: 1, filingUploads: 0 });
  await writeFile(
    join(env.artifacts, "document-bounded-authenticated-response.json"),
    JSON.stringify({ stream, unknown, recovered, replayed }, null, 2),
  );
}, 120000);

async function correctedReport(context: Awaited<ReturnType<typeof signingFixture>>) {
  const snapshotId = context.draft.input.statementSnapshotIds[0];

  if (!snapshotId) throw new Error("Synthetic retained statement required");

  const draft = await post(
    context.book,
    "/reports/annual/drafts",
    {
      ...context.draft.input,
      facts: [
        ...context.draft.input.facts,
        {
          semanticId: "revenue",
          snapshotId,
          rowId: "income_total",
          notApplicable: false,
          evidenceRefs: [context.source.id],
          calculationRefs: [],
        },
      ],
      reason: "Corrected synthetic report adds the retained revenue disclosure",
    },
    Report.AnnualReportDraft,
  );

  const approval = await post(
    context.reviewer,
    `/reports/annual/drafts/${draft.id}/approvals`,
    { version: 1, digest: draft.digest },
    Report.AnnualReportApproval,
  );

  const final = await post(
    context.book,
    `/reports/annual/drafts/${draft.id}/finalize`,
    { version: 1, digest: draft.digest, approvalId: approval.id },
    Report.AnnualReportFinal,
  );

  const presentation = await post(
    context.book,
    `/reports/annual/finals/${final.id}/presentation`,
    {
      finalId: final.id,
      displayRule: { scale: 0, rounding: "exact" },
      totals: [
        { label: "assets", memberSemanticIds: ["assets"] },
        { label: "revenue", memberSemanticIds: ["revenue"] },
      ],
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
      contexts: [
        { contextRef: "year_end", period: "2026-12-31", dimensions: [] },
        { contextRef: "year", period: "2026-01-01/2026-12-31", dimensions: [] },
      ],
      conceptMappings: [
        { semanticId: "assets", concept: "se:Assets", contextRef: "year_end", unitRef: "SEK" },
        { semanticId: "revenue", concept: "se:Revenue", contextRef: "year", unitRef: "SEK" },
      ],
    },
    Report.ReportArtifact,
  );

  const validation = await post(
    context.book,
    `${documents}/validations`,
    { artifactId: artifact.id },
    Documents.DocumentValidation,
  );

  expect(validation.result).toBe("passed");

  const manifest = await post(
    context.book,
    `${documents}/manifests`,
    {
      artifactId: artifact.id,
      validationId: validation.id,
      governanceId: context.governance.id,
      purpose: "annual_report_signing",
      consentText: "Sign the corrected exact synthetic annual report",
      policyRelease: "synthetic-signature-v1",
    },
    Documents.DocumentManifest,
  );

  const adoption = await post(
    context.book,
    `${filings}/adoptions`,
    { manifestId: manifest.id, evidenceId: context.source.id, adoptedOn: "2027-02-02" },
    Filing.AdoptionRecord,
  );

  await failure(
    await request(context.book, `${filings}/adoptions/${adoption.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ digest: adoption.digest, reason: "Capture cannot review itself" }),
    }),
    403,
    "Forbidden",
  );
  await post(
    context.reviewer,
    `${filings}/adoptions/${adoption.id}/reviews`,
    { digest: adoption.digest, reason: "Independent corrected report adoption" },
    Filing.AdoptionReview,
  );

  return { ...context, draft, final, presentation, artifact, validation, manifest, adoption };
}

test("rejected filing requires fresh original signatures and exact reviewed adoption before linked correction", async () => {
  const context = await signingFixture();
  await sign(context);
  await sign(context, context.reviewer);

  const prepareInput = {
    manifestId: context.manifest.id,
    copyArtifactId: context.artifact.id,
    copyValidationId: context.validation.id,
    adoptionId: context.adoption.id,
    governanceId: context.governance.id,
    certifierId: context.reviewer.actorId,
    requiredOutcome: "registered",
    predecessorIntentId: null,
  };

  const original = await post(
    context.book,
    `${filings}/intents`,
    prepareInput,
    Filing.FilingIntent,
  );

  await post(
    context.book,
    `${filings}/intents/${original.id}/authorizations`,
    { digest: original.digest },
    Filing.FilingAuthorization,
  );
  await post(
    context.book,
    `${filings}/intents/${original.id}/upload`,
    { digest: original.digest },
    Filing.FilingView,
  );
  await post(
    context.reviewer,
    `${filings}/intents/${original.id}/certify`,
    { digest: original.digest },
    Filing.FilingView,
  );
  await configure(original.correlation, { status: "rejected" });

  const rejected = await post(
    context.book,
    `${filings}/intents/${original.id}/collect`,
    { digest: original.digest },
    Filing.FilingView,
  );

  expect(rejected.state).toBe("rejected");
  expect(rejected.fulfilled).toBe(false);
  const corrected = await correctedReport(context);

  const correctedInput = {
    manifestId: corrected.manifest.id,
    copyArtifactId: corrected.artifact.id,
    copyValidationId: corrected.validation.id,
    adoptionId: corrected.adoption.id,
    governanceId: corrected.governance.id,
    certifierId: corrected.reviewer.actorId,
    requiredOutcome: "registered",
    predecessorIntentId: original.id,
  };

  const incomplete = await decoded(
    await request(corrected.book, `${documents}/manifests/${corrected.manifest.id}`),
    Documents.SignatureManifestView,
  );

  expect(incomplete.signatures).toEqual([]);
  expect(incomplete.complete).toBe(false);
  await failure(
    await request(corrected.book, `${filings}/intents`, {
      method: "POST",
      body: JSON.stringify(correctedInput),
    }),
    409,
    "StaleDependency",
  );
  await sign(corrected);
  await sign(corrected, corrected.reviewer);
  await failure(
    await request(corrected.book, `${filings}/intents`, {
      method: "POST",
      body: JSON.stringify({ ...correctedInput, adoptionId: context.adoption.id }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(corrected.book, `${filings}/intents`, {
      method: "POST",
      body: JSON.stringify({ ...correctedInput, copyValidationId: context.validation.id }),
    }),
    409,
    "StaleDependency",
  );

  const next = await post(
    corrected.book,
    `${filings}/intents`,
    correctedInput,
    Filing.FilingIntent,
  );

  expect(next.input.predecessorIntentId).toBe(original.id);
  expect(next.copyArtifactHash).not.toBe(original.copyArtifactHash);
  expect(next.signatureEvidenceIds).toHaveLength(2);

  const history = await decoded(
    await request(corrected.book, `${filings}/years/fy_2026/history`),
    Filing.FilingHistory,
  );

  expect(history.items).toHaveLength(2);
  expect(history.items[0]?.state).toBe("rejected");
  expect(history.items[1]?.state).toBe("prepared");
  await writeFile(
    join(environment().artifacts, "filing-corrected-adopted-copy.json"),
    JSON.stringify({ original, rejected, corrected: corrected.manifest, next, history }, null, 2),
  );
}, 120000);
