import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assetClients } from "./asset-fixture-clients.mjs";
export const peppolAccounts = [
 { id: "account_ar", code: "1510", name: "Kundfordringar" },
 { id: "account_revenue", code: "3001", name: "Försäljning" },
 { id: "account_vat", code: "2611", name: "Utgående moms" },
];
const key = () => randomUUID();
async function issuePeppolInvoice(clients, fixture) {
  const { author, reviewer, activator, post, source, today } = clients;
  const ref = { evidenceId: source.id, sha256: source.sha256 };

  const seller = {
    legalName: "Fjällby Konsult AB",
    registrationNumber: "5560000001",
    vatRegistrationNumber: "SE556000000101",
    postalAddress: "Synthetic address, not a real company",
    countryCode: "SE",
  };

  const candidate = await post(author, "/commerce/invoice-policies", {
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
  });

  const review = await post(reviewer, `/commerce/invoice-policies/${candidate.id}/review`, {
    candidateDigest: candidate.digest,
    reviewEvidence: ref,
    findings: "Synthetic fixture for the existing bounded profile, not company qualification.",
    acknowledgeNoLegalActivation: true,
  });

  const policy = await post(activator, "/commerce/legal-sales-policies", {
    candidateId: candidate.id,
    candidateDigest: candidate.digest,
    reviewId: review.id,
    reviewDigest: review.digest,
    series: "F-2026",
    ruleVersion: "se-domestic-standard-25-2023-200-v1",
    sourceEvidence: ref,
    activationEvidence: ref,
    reason: "Synthetic native workflow exercise",
    acceptReviewedPolicy: true,
    acknowledgeIssueBlocked: true,
  });

  const profile = await post(author, "/commerce/ar-legal-accounting-profiles", {
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
  });

  const customer = await post(author, "/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: key(),
    role: "customer",
    displayName: "Skogsbruk Nord AB",
    evidenceId: source.id,
    reason: "Synthetic fixture",
  });

  const draft = await post(author, "/commerce/invoice-drafts", {
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
      buyerReference: null,
      orderReference: null,
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
  });

  const issueReview = await post(author, "/commerce/ar-legal-issue-reviews", {
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
    accountingPeriodId: fixture.periods[0].id,
    voucherSeries: "A",
    reason: "Synthetic original issue",
    acknowledgeLimitedProfile: true,
  });

  const approvalInput = { version: 1, digest: issueReview.digest, acknowledgeLimitedProfile: true };

  const issueApproval = await post(
    reviewer,
    `/commerce/ar-legal-issue-reviews/${issueReview.id}/approvals`,
    approvalInput,
  );

  const original = await post(
    reviewer,
    `/commerce/ar-legal-issue-reviews/${issueReview.id}/execute`,
    { ...approvalInput, approvalId: issueApproval.id },
  );

  return original;
}

export async function seedPeppol(config) {
  const clients = await assetClients(config);
  const issue = await issuePeppolInvoice(clients, config.fixture);
  const document = { kind: "invoice", id: issue.id };
  const common = { document, schemeId: "0007", providerAccount: "synthetic-ap-v1", active: true,
    evidenceId: clients.source.id, acknowledgeSyntheticAccessPoint: true };
  const sender = await clients.post(clients.author, "/commerce/peppol/bindings", { ...common, role: "sender", participantId: "5560000001", buyerReference: null, paymentAccountReference: "1234567" });
  const recipient = await clients.post(clients.author, "/commerce/peppol/bindings", { ...common, role: "recipient", participantId: "5560000019", buyerReference: null, paymentAccountReference: null });
  const review = await clients.post(clients.reviewer, "/commerce/peppol/reviews", { document, senderBindingId: sender.id, recipientBindingId: recipient.id });
  if (review.outcome !== "blocked" || review.validation.outcome !== "ValidationFailed" || !JSON.stringify(review.validation).includes("PEPPOL-EN16931-R003")) throw new Error("M59 needs actual pinned R003 refusal");
  const result = { issueId: issue.id, reviewId: review.id, legalNumber: issue.legalDocumentNumber,
    documentDigest: issue.digest, reviewDigest: review.digest, senderBindingId: sender.id, recipientBindingId: recipient.id,
    route: `/entities/${config.fixture.entity.id}/books/${config.fixture.book.id}/sales?view=peppol&record=${issue.id}&review=${review.id}` };
  await writeFile(join(config.artifacts, "peppol-fixture.json"), JSON.stringify(result, null, 2));
  return result;
}
