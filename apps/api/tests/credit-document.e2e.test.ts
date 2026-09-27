import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Policy from "@open-erp/contracts/invoice-policy";
import * as Legal from "@open-erp/contracts/legal-sales-policy";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Credits from "@open-erp/contracts/customer-credit-notes";
import {
  apiDirectory,
  createSession,
  database,
  decoded,
  environment,
  evidence,
  fixture,
  key,
  ledger,
  persisted,
  post,
  request,
  failure,
  type BookFixture,
} from "./support/fixtures";

async function legalFixture() {
  const book = await fixture([
    { id: "account_ar", code: "1510", name: "Synthetic receivables" },
    { id: "account_revenue", code: "3001", name: "Synthetic revenue" },
    { id: "account_vat", code: "2611", name: "Synthetic output VAT" },
  ]);

  const second = await fixture();
  const third = await fixture();
  const admin = await database();
  let today: string;

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1,$2,'operator'),($1,$3,'operator')",
      [book.bookId, second.actorId, third.actorId],
    );

    const time = await admin.query<{ today: string }>(
      "SELECT (clock_timestamp() at time zone 'UTC')::date::text AS today",
    );

    if (!time.rows[0]) throw new Error("The fixture needs the database date.");

    today = time.rows[0].today;
  } finally {
    await admin.end();
  }

  const author = { ...book, token: (await createSession(book)).token };
  const reviewer = { ...book, actorId: second.actorId, token: (await createSession(second)).token };
  const activator = { ...book, actorId: third.actorId, token: (await createSession(third)).token };
  const source = await evidence(book);
  const ref = { evidenceId: source.id, sha256: source.sha256 };

  const seller = {
    legalName: "FWD-05 Synthetic Seller",
    registrationNumber: "556677-8899",
    vatRegistrationNumber: "SE556677889901",
    postalAddress: "Synthetic address, not a real company",
    countryCode: "SE",
  };

  const candidate = await post(
    author,
    "/commerce/invoice-policies",
    {
      profileKey: "fwd05_synthetic",
      sellerIdentity: seller,
      sellerEvidence: ref,
      legalNumbering: "sequential-per-series-v1",
      numberingEvidence: ref,
      vatTreatment: "se-domestic-standard-25-v1",
      vatEvidence: ref,
      roundingMethod: "line-tax-half-up-minor-v1",
      roundingEvidence: ref,
      creditNotePolicy: "Link the original and retain exact credit capacity; no refund.",
      correctionPolicy: "Preserve the original and issue a linked correction.",
      correctionEvidence: ref,
      effectiveFrom: today,
      reason: "Isolated synthetic qualification only",
      acknowledgeUnactivated: true,
    },
    Policy.InvoicePolicyCandidate,
  );

  const review = await post(
    reviewer,
    `/commerce/invoice-policies/${candidate.id}/review`,
    {
      candidateDigest: candidate.digest,
      reviewEvidence: ref,
      findings: "Synthetic fixture for the existing bounded profile, not company qualification.",
      acknowledgeNoLegalActivation: true,
    },
    Policy.InvoicePolicyReview,
  );

  const policy = await post(
    activator,
    "/commerce/legal-sales-policies",
    {
      candidateId: candidate.id,
      candidateDigest: candidate.digest,
      reviewId: review.id,
      reviewDigest: review.digest,
      series: "TEST",
      ruleVersion: "se-domestic-standard-25-2023-200-v1",
      sourceEvidence: ref,
      activationEvidence: ref,
      reason: "Synthetic native workflow exercise",
      acceptReviewedPolicy: true,
      acknowledgeIssueBlocked: true,
    },
    Legal.LegalSalesPolicy,
  );

  const profile = await post(
    author,
    "/commerce/ar-legal-accounting-profiles",
    {
      policyId: policy.id,
      policyDigest: policy.digest,
      profile: "se-domestic-b2b-sek-25-accrual-v1",
      accountingMethod: "accrual",
      ruleVersion: "se-domestic-standard-25-2023-200-v1",
      effectiveFrom: today,
      controlAccountId: "account_ar",
      revenueAccountId: "account_revenue",
      outputVatAccountId: "account_vat",
      accountRoleEvidence: ref,
      reason: "Synthetic role mapping",
      acceptLegalAccounting: true,
    },
    Ar.ArLegalAccountingProfile,
  );

  const customer = await post(
    author,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "customer",
      displayName: "FWD-05 Synthetic Customer",
      evidenceId: source.id,
      reason: "Synthetic fixture",
    },
    Commerce.CounterpartyRevision,
  );

  const draft = await post(
    author,
    "/commerce/invoice-drafts",
    {
      draftKey: `credit_fixture_${key()}`,
      content: {
        title: "Synthetic credit document journey",
        counterpartyId: customer.id,
        counterpartyRevision: customer.revision,
        seller: {
          legalName: seller.legalName,
          registrationId: seller.registrationNumber,
          taxId: seller.vatRegistrationNumber,
          address: seller.postalAddress,
          countryCode: "SE",
          evidenceId: source.id,
        },
        customer: {
          legalName: customer.displayName,
          registrationId: "556677-8808",
          taxId: null,
          address: "Synthetic customer address",
          countryCode: "SE",
          evidenceId: source.id,
        },
        currency: "SEK",
        currencyScale: 2,
        plannedIssueDate: today,
        supplyDate: today,
        dueDate: today,
        paymentTerms: "Synthetic only; no payment requested",
        sourceTotalMinor: "12500",
        lines: [
          {
            id: "line_1",
            description: "Synthetic service",
            quantity: "1",
            unitPriceMinor: "10000",
            baseMinor: "10000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "2500",
            taxDescription: "se-domestic-standard-25-v1",
            taxEvidenceId: source.id,
            sourceGrossMinor: "12500",
          },
        ],
      },
    },
    Drafts.InvoiceDraftRevision,
  );

  const issueReview = await post(
    author,
    "/commerce/ar-legal-issue-reviews",
    {
      profile: "se-domestic-b2b-sek-25-accrual-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      policyId: policy.id,
      policyDigest: policy.digest,
      accountingProfileId: profile.id,
      accountingProfileDigest: profile.digest,
      controlAccountId: "account_ar",
      revenueAccountId: "account_revenue",
      outputVatAccountId: "account_vat",
      accountingPeriodId: "period_2026",
      voucherSeries: "A",
      reason: "Synthetic original issue",
      acknowledgeLimitedProfile: true,
    },
    Ar.ArLegalIssueReview,
  );

  const approvalInput = { version: 1, digest: issueReview.digest, acknowledgeLimitedProfile: true };

  const issueApproval = await post(
    reviewer,
    `/commerce/ar-legal-issue-reviews/${issueReview.id}/approvals`,
    approvalInput,
    Ar.ArLegalIssueApproval,
  );

  const original = await post(
    reviewer,
    `/commerce/ar-legal-issue-reviews/${issueReview.id}/execute`,
    { ...approvalInput, approvalId: issueApproval.id },
    Ar.ArLegalIssueReceipt,
  );

  return { book, author, reviewer, today, profile, original, customer };
}

async function credit(
  context: Awaited<ReturnType<typeof legalFixture>>,
  reason: string,
  net: string,
  tax: string,
) {
  const { author, reviewer, original, profile, today } = context;

  const decision = await post(
    author,
    "/evidence",
    {
      title: "Synthetic credit decision",
      content: `${key()}: ${reason}`,
      mediaType: "text/plain",
      origin: "FWD-05 synthetic E2E",
    },
    Accounting.Evidence,
  );

  const review = await post(
    author,
    "/commerce/customer-credit-reviews",
    {
      profile: "se-domestic-b2b-sek-25-accrual-credit-v1",
      originalLegalIssueId: original.id,
      originalIssueDigest: original.digest,
      accountingProfileId: profile.id,
      accountingProfileDigest: profile.digest,
      accountingPeriodId: "period_2026",
      voucherSeries: "A",
      creditEvidenceId: decision.id,
      creditDate: today,
      reason,
      selectedLines: [{ originalLineId: "line_1", creditedNetMinor: net, creditedTaxMinor: tax }],
      acknowledgeNoRefundOrCreditBalance: true,
      acknowledgeVatReturnConsequenceUnobserved: true,
    },
    Credits.CustomerCreditReview,
  );

  const input = { version: 1, digest: review.digest, acknowledgeLimitedProfile: true };

  const approved = await post(
    reviewer,
    `/commerce/customer-credit-reviews/${review.id}/approvals`,
    input,
    Credits.CustomerCreditApproval,
  );

  await failure(
    await request(reviewer, `/change-sets/${review.postingPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: review.postingPlan.planDigest }),
    }),
    422,
    "InvalidJournal",
  );

  return post(
    reviewer,
    `/commerce/customer-credit-reviews/${review.id}/execute`,
    { ...input, approvalId: approved.id },
    Credits.CustomerCreditReceipt,
  );
}

// These wire expectations describe the new public artifact boundary before its implementation.
const Descriptor = Schema.Struct({
  id: Accounting.Identifier,
  creditId: Accounting.Identifier,
  documentId: Accounting.Identifier,
  documentRevision: Schema.String,
  documentDigest: Accounting.Digest,
  rendererVersion: Schema.Literal("openerp-se-credit-note-v1"),
  mediaType: Schema.Literal("application/pdf"),
  sha256: Schema.String,
  byteLength: Schema.Int,
  delivered: Schema.Literal(false),
});

const ArtifactView = Schema.Struct({
  state: Schema.Literals(["pending", "rendering_failed", "available"]),
  document: Credits.CustomerCreditSemanticDocument,
  artifact: Schema.NullOr(Descriptor),
  lastFailure: Schema.NullOr(Schema.Struct({ code: Accounting.FailureCode })),
});

async function artifactState(book: BookFixture, creditId: string) {
  return decoded(
    await request(book, `/commerce/customer-credit-notes/${creditId}/artifact`),
    ArtifactView,
  );
}

test("credit PDF recovery consumes the retained document intent without issuing or posting again", async () => {
  const context = await legalFixture();
  const { book, author, original, customer } = context;
  const issued = await credit(context, "Agreed partial credit", "2000", "500");
  const unrenderable = await credit(context, "Unsupported glyph fixture 🧾", "1000", "250");
  const queued = await credit(context, "Credit rendered after listener restart", "1000", "250");
  const before = await persisted(book);
  const balances = await ledger(book);
  expect(
    balances.accounts.find((account) => account.accountId === "account_ar")?.balanceMinor,
  ).toBe("7500");
  expect((await artifactState(book, issued.id)).state).toBe("pending");

  await failure(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      body: JSON.stringify({
        expectedDocumentDigest: original.digest,
        rendererVersion: "openerp-se-credit-note-v1",
      }),
    }),
    409,
    "StaleDependency",
  );

  await post(
    author,
    `/commerce/counterparties/${customer.id}/revisions`,
    {
      expectedRevision: customer.revision,
      displayName: "Changed after credit issue",
      evidenceId: customer.evidence.evidenceId,
      reason: "The frozen document must retain the earlier name",
    },
    Commerce.CounterpartyRevision,
  );

  const renderInput = {
    expectedDocumentDigest: issued.semanticDocument.digest,
    rendererVersion: "openerp-se-credit-note-v1",
  };

  const renderKey = key();
  const admin = await database();

  try {
    await admin.query(`CREATE FUNCTION openerp.e2e_credit_ack_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', DETAIL = 'Unavailable', MESSAGE = 'Synthetic credit checkpoint fault'; END $$;
      CREATE TRIGGER e2e_credit_ack_fault BEFORE UPDATE OF delivered_at ON openerp.outbox
      FOR EACH ROW EXECUTE FUNCTION openerp.e2e_credit_ack_fault()`);

    await failure(
      await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
        method: "POST",
        headers: { "idempotency-key": renderKey },
        body: JSON.stringify(renderInput),
      }),
      503,
      "Unavailable",
    );

    const checkpointFailure = await artifactState(book, issued.id);
    expect(checkpointFailure.state).toBe("rendering_failed");
    expect(checkpointFailure.artifact).toBeNull();
    expect(checkpointFailure.lastFailure?.code).toBe("Unavailable");
    expect(await persisted(book)).toEqual(before);
  } finally {
    await admin.query(
      "DROP TRIGGER IF EXISTS e2e_credit_ack_fault ON openerp.outbox; DROP FUNCTION IF EXISTS openerp.e2e_credit_ack_fault()",
    );
    await admin.end();
  }

  const direct = await decoded(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      headers: { "idempotency-key": renderKey },
      body: JSON.stringify(renderInput),
    }),
    Descriptor,
  );

  expect(direct.documentDigest).toBe(issued.semanticDocument.digest);
  expect((await artifactState(book, queued.id)).state).toBe("pending");

  // The remaining intents were committed while the Bun listener was offline.
  const child = spawn("bun", ["scripts/preparation-runner.ts"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: environment().runtimeUrl,
      OPENERP_PREPARATION_TOKEN: book.token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  let startupError: Error | undefined;
  child.once("error", (error) => {
    startupError = error;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });

  try {
    const deadline = Date.now() + 30000;
    let ready = false;

    while (Date.now() < deadline) {
      const good = await artifactState(book, queued.id);
      const bad = await artifactState(book, unrenderable.id);

      if (good.state === "available" && bad.state === "rendering_failed") {
        ready = true;
        break;
      }

      if (startupError) throw startupError;

      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Credit runner stopped: ${log}`);

      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }

    expect(ready, log).toBe(true);
  } finally {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");

      const killDeadline = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000);

      child.kill("SIGTERM");

      try {
        await exited;
      } finally {
        clearTimeout(killDeadline);
      }
    }

    await writeFile(join(environment().artifacts, "credit-render-runner.log"), log);
  }

  const available = await artifactState(book, issued.id);
  const failed = await artifactState(book, unrenderable.id);
  expect(available.document.customer.legalName).toBe("FWD-05 Synthetic Customer");
  expect(available.document.totals).toEqual({
    netMinor: "2000",
    taxMinor: "500",
    grossMinor: "2500",
  });
  expect(failed.lastFailure?.code).toBe("UnsupportedProfile");
  expect(failed.artifact).toBeNull();
  expect(await persisted(book)).toEqual(before);

  const input = {
    expectedDocumentDigest: issued.semanticDocument.digest,
    rendererVersion: "openerp-se-credit-note-v1",
  };

  const commandKey = key();

  const replay = await decoded(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    Descriptor,
  );

  const again = await decoded(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    }),
    Descriptor,
  );

  expect(again).toEqual(replay);
  expect(replay).toEqual(available.artifact);

  await failure(
    await request(book, `/commerce/customer-credit-notes/${issued.id}/artifact`, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ ...input, expectedDocumentDigest: original.digest }),
    }),
    409,
    "IdempotencyConflict",
  );

  const bytes = await decoded(
    await request(book, `/commerce/customer-credit-artifacts/${replay.id}`),
    Schema.Struct({ ...Descriptor.fields, contentBase64: Schema.String }),
  );

  const pdf = Buffer.from(bytes.contentBase64, "base64");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBe(bytes.byteLength);
  expect(createHash("sha256").update(pdf).digest("hex")).toBe(bytes.sha256);
  expect(bytes.documentDigest).toBe(issued.semanticDocument.digest);
  expect(bytes.documentRevision).toBe(issued.semanticDocument.revision);
  expect(
    await decoded(
      await request(book, `/commerce/customer-credit-notes/${issued.id}`),
      Credits.CustomerCreditReceipt,
    ),
  ).toEqual(issued);

  const outsider = await fixture();
  await failure(
    await request(outsider, `/commerce/customer-credit-artifacts/${replay.id}`),
    404,
    "NotFound",
  );
  expect(await persisted(book)).toEqual(before);
  expect(await ledger(book)).toEqual(balances);

  await writeFile(join(environment().artifacts, "customer-credit.pdf"), pdf);
  await writeFile(
    join(environment().artifacts, "credit-document-journey.json"),
    JSON.stringify(
      {
        dataClass: "synthetic_e2e",
        original,
        issued,
        unrenderable,
        queued,
        direct,
        available,
        failed,
        replay,
        before,
        balances,
        limits:
          "PDF creation only; no delivery, refund, VAT-return consequence or actual-company qualification.",
      },
      null,
      2,
    ),
  );
}, 60000);
