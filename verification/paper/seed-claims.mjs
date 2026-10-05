import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assetClients } from "./asset-fixture-clients.mjs";

export const claimAccounts = [
  { id: "claim_expense", code: "6110", name: "Kontorsmaterial" },
  { id: "claim_vat", code: "2641", name: "Ingående moms" },
  { id: "claim_liability", code: "2820", name: "Skulder till anställda" },
];

export async function seedClaims(config) {
  const clients = await assetClients(config);
  const { book, reviewer, author, post } = clients;
  const employeeId = "employee_anders_berg";
  const evidence = await post(reviewer, "/evidence", {
    title: "R40 synthetic receipt qualification",
    content: "Disposable three-receipt claim, no real employee or company data",
    mediaType: "text/plain",
    origin: "R40 local synthetic fixture",
  });
  await post(book, "/payroll/access", { actorId: "paper_asset_reviewer", allowed: true });
  await post(book, "/payroll/access", { actorId: config.fixture.actor.id, allowed: true });
  await post(reviewer, "/payroll/revisions", {
    employeeId,
    kind: "employment",
    effectiveOn: "2026-10-01",
    supersedes: null,
    evidenceId: evidence.id,
    body: {
      personRef: "Anders Berg",
      jurisdiction: "SE",
      residency: "Synthetic employee",
      payTerms: "Synthetic employee claims only",
      workSchedule: "Synthetic employee claims only",
      taxFacts: "No payroll calculation or statutory qualification",
    },
  });
  const stationery = await post(reviewer, "/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: "paper_r40_pappershuset",
    role: "supplier",
    displayName: "Pappershuset AB",
    evidenceId: evidence.id,
    reason: "R40 synthetic receipt supplier",
  });
  const taxi = await post(reviewer, "/commerce/counterparties", {
    kind: "synthetic_counterparty_v1",
    externalKey: "paper_r40_taxi",
    role: "supplier",
    displayName: "Taxi Östersund",
    evidenceId: evidence.id,
    reason: "R40 synthetic company-paid receipt supplier",
  });
  const amounts = { grossMinor: "1250000", netMinor: "1000000", vatMinor: "250000" };
  const firstText = JSON.stringify({
    profile: "synthetic-employee-receipt-v1",
    recordClass: "synthetic",
    employeeId,
    paidBy: "employee",
    counterpartyId: stationery.id,
    supplierDocumentNumber: "7731",
    sourceLineId: "receipt_line_1",
    currency: "SEK",
    issuedOn: "2026-10-03",
    ...amounts,
    purpose: "kontorsmaterial",
  });
  const companyText = JSON.stringify({
    profile: "synthetic-employee-receipt-v1",
    recordClass: "synthetic",
    employeeId,
    paidBy: "company",
    counterpartyId: taxi.id,
    supplierDocumentNumber: "TAXI-2026-10-03",
    sourceLineId: "receipt_line_1",
    currency: "SEK",
    issuedOn: "2026-10-03",
    grossMinor: "64000",
    netMinor: "64000",
    vatMinor: "0",
    purpose: "3 okt, betald med företagskort",
  });
  async function retain(occurrenceKey, filename, text) {
    return post(reviewer, "/source-occurrences", {
      sourceSystem: "paper_employee_claims",
      sourceAccountId: employeeId,
      occurrenceKey,
      sourceRevision: "1",
      filename,
      mediaType: "application/json",
      contentBase64: Buffer.from(text, "utf8").toString("base64"),
    });
  }
  const first = await retain("paper_r40_receipt_1", "kvitto-7731.json", firstText);
  const company = await retain("paper_r40_receipt_2", "taxi-3-okt.json", companyText);
  const duplicate = await retain("paper_r40_receipt_3", "kvitto-7731-igen.json", firstText);
  if (first.id === duplicate.id || first.sha256 !== duplicate.sha256)
    throw new Error("R40 requires distinct occurrences of identical receipt bytes");
  const receiptEvidence = await post(reviewer, "/evidence", {
    title: "Pappershuset AB, kvitto 7731",
    origin: "R40 retained synthetic receipt",
    mediaType: "application/json",
    content: firstText,
  });
  if (receiptEvidence.sha256 !== first.sha256.slice(7))
    throw new Error("R40 receipt evidence hash differs from its retained original");
  const taxSource = await post(reviewer, "/expense-tax/sources", {
    sourceKey: "paper_r40_receipt_7731",
    expectedSourceDigest: null,
    facts: {
      evidenceId: receiptEvidence.id,
      sourceLocator: first.id,
      description: "Pappershuset AB, kontorsmaterial, kvitto 7731",
      recordClass: "synthetic",
      amounts,
      currency: "SEK",
      currencyScale: 2,
      supplierJurisdiction: "SE",
      supplyJurisdiction: "SE",
      issuedOn: "2026-10-03",
      receivedOn: "2026-10-03",
      suppliedOn: "2026-10-03",
      taxPointOn: "2026-10-03",
      changeSetId: null,
      voucherId: null,
    },
  });
  const taxReview = await post(author, `/expense-tax/sources/${taxSource.sourceId}/reviews`, {
    sourceDigest: taxSource.digest,
    expectedReviewDigest: null,
    facts: {
      evidenceId: evidence.id,
      rationale: "Independent R40 synthetic receipt tax review",
      amounts,
      registration: "registered",
      registrationEvidenceId: evidence.id,
      method: "accrual",
      methodEvidenceId: evidence.id,
      bookJurisdiction: "SE",
      suppliedOn: "2026-10-03",
      taxPointOn: "2026-10-03",
      dateBasis: "document_date",
      dateEvidenceId: evidence.id,
      treatment: "domestic_purchase",
      profileId: "synthetic-expense-tax",
      profileVersion: "1",
      rateNumerator: "1",
      rateDenominator: "4",
      deductionNumerator: "1",
      deductionDenominator: "1",
      deductionBasis: "Synthetic full deduction",
      deductionEvidenceId: evidence.id,
      roundingPolicy: "exact_only",
    },
  });
  const selection = (occurrence) => ({
    occurrenceId: occurrence.id,
    sha256: occurrence.sha256,
    taxSourceId: null,
    taxSourceDigest: null,
    taxReviewDigest: null,
  });
  const revision = await post(reviewer, "/payroll/claims", {
    claimKey: "paper_r40_anders_october",
    employeeId,
    month: "2026-10",
    purpose: "Utlägg från Anders Berg, 3 kvitton",
    items: [
      {
        ...selection(first),
        taxSourceId: taxSource.sourceId,
        taxSourceDigest: taxSource.digest,
        taxReviewDigest: taxReview.digest,
      },
      selection(company),
      selection(duplicate),
    ],
  });
  const review = await post(reviewer, `/payroll/claims/${revision.claimId}/reviews`, {
    revisionDigest: revision.digest,
    directMinor: "500000",
    expenseAccountId: "claim_expense",
    inputVatAccountId: "claim_vat",
    liabilityAccountId: "claim_liability",
    accountingPeriodId: config.fixture.periods[0].id,
    postingDate: "2026-10-03",
    series: "A",
  });
  if (
    review.liabilityMinor !== "1250000" ||
    review.directMinor !== "500000" ||
    review.payrollMinor !== "750000"
  )
    throw new Error("R40 retained split differs from literal receipt expectation");
  async function read(path) {
    const response = await fetch(
      `${config.apiUrl}/api/v1/entities/${config.fixture.entity.id}/books/${config.fixture.book.id}${path}`,
      {
        headers: { authorization: `Bearer ${author.token}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error(`R40 fixture read refused ${response.status}`);
    return response.json();
  }
  const view = await read(`/payroll/claims/${revision.claimId}`);
  const runs = await read("/payroll/runs");
  if (
    view.recognition !== null ||
    view.instructions.length !== 0 ||
    !view.approvalAllowed ||
    view.currentReview?.digest !== review.digest ||
    runs.items.length !== 0 ||
    runs.next !== null
  )
    throw new Error(
      "R40 fixture must retain an independently approvable unposted claim without payroll runs",
    );
  const result = {
    kind: "synthetic_employee_claim_fixture",
    claimId: revision.claimId,
    reviewId: review.id,
    path: `/entities/${config.fixture.entity.id}/books/${config.fixture.book.id}/tax?view=claims&record=${encodeURIComponent(revision.claimId)}`,
  };
  await writeFile(
    join(config.artifacts, "claim-fixture.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}
