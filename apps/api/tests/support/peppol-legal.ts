import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Policy from "@open-erp/contracts/invoice-policy";
import * as Legal from "@open-erp/contracts/legal-sales-policy";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import { createSession, database, evidence, fixture, key, post } from "./fixtures";

export async function peppolLegalFixture(
  extraAccounts: ReadonlyArray<{ id: string; code: string; name: string }> = [],
  invoice?: {
    lines: ReadonlyArray<Omit<typeof Drafts.DraftLine.Type, "taxEvidenceId">>;
    sourceTotalMinor: string;
  },
) {
  const book = await fixture([
    { id: "account_ar", code: "1510", name: "Synthetic receivables" },
    { id: "account_revenue", code: "3001", name: "Synthetic revenue" },
    { id: "account_vat", code: "2611", name: "Synthetic output VAT" },
    ...extraAccounts,
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
    legalName: "Synthetic Peppol Seller",
    registrationNumber: "5560000001",
    vatRegistrationNumber: "SE556000000101",
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
      displayName: "Synthetic Peppol Customer",
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
          registrationId: "5560000019",
          taxId: "SE556000001901",
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
        sourceTotalMinor: invoice?.sourceTotalMinor ?? "12500",
        lines: invoice
          ? invoice.lines.map((line) => ({ ...line, taxEvidenceId: source.id }))
          : [
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
