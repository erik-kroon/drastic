import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileObjectStore } from "../../scripts/file-object-store";
import * as A from "@open-erp/contracts/accounting";
import * as Claims from "@open-erp/contracts/employee-claims";
import * as Tax from "@open-erp/contracts/expense-tax";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Source from "@open-erp/contracts/source-intake";
import * as Foundation from "@open-erp/contracts/payroll-foundation";
import { payrollFixture } from "./payroll-runs";
import { createSession, database, key, post, decoded, request, environment } from "./fixtures";

export async function employeeClaimFixture() {
  const f = await payrollFixture();
  const authorSession = await createSession(f.book);
  const reviewerSession = await createSession(f.reviewer);
  const book = { ...f.book, token: authorSession.token };
  const reviewer = { ...f.reviewer, token: reviewerSession.token };
  await post(
    book,
    "/payroll/access",
    { actorId: reviewer.actorId, allowed: true },
    Foundation.PayrollAccessResult,
  );
  const admin = await database();

  try {
    for (const [id, code, name] of [
      ["claim_expense", "6110", "Employee office expense"],
      ["claim_vat", "2641", "Claim deductible input VAT"],
      ["claim_liability", "2891", "Employee claim debt"],
    ]) {
      await admin.query(
        "insert into openerp.accounts(book_id,id,code,name,active) values($1,$2,$3,$4,true)",
        [book.bookId, id, code, name],
      );
    }
  } finally {
    await admin.end();
  }

  const source = await post(
    book,
    "/evidence",
    {
      title: "Claim source authority",
      mediaType: "text/plain",
      origin: "Synthetic R40 verification",
      content: "Synthetic employee claim source and independent payee evidence",
    },
    A.Evidence,
  );

  const evidence = { evidenceId: source.id, sha256: source.sha256 };

  const office = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Pappershuset AB",
      evidenceId: source.id,
      reason: "Synthetic R40 supplier",
    },
    Commerce.CounterpartyRevision,
  );

  const taxi = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Taxi Stockholm",
      evidenceId: source.id,
      reason: "Synthetic R40 supplier",
    },
    Commerce.CounterpartyRevision,
  );

  const employeeId = f.calculation.employeeId;
  const employeeRevisionId = f.calculation.basis.employmentRevisionId;

  const receipt: typeof Claims.SyntheticEmployeeReceipt.Type = {
    profile: "synthetic-employee-receipt-v1",
    recordClass: "synthetic",
    employeeId,
    paidBy: "employee",
    counterpartyId: office.id,
    supplierDocumentNumber: "7731",
    sourceLineId: "receipt_line",
    currency: "SEK",
    issuedOn: "2026-01-15",
    grossMinor: "1250000",
    netMinor: "1000000",
    vatMinor: "250000",
    purpose: "Synthetic office supplies",
  };

  const items: Array<typeof Claims.ClaimSourceSelection.Type> = [];
  let taxSource: typeof Tax.TaxSourceRevision.Type | null = null;
  let taxReview: typeof Tax.TaxReview.Type | null = null;

  for (const [ordinal, row] of [
    receipt,
    {
      ...receipt,
      counterpartyId: taxi.id,
      supplierDocumentNumber: "TAXI-040",
      paidBy: "company" as const,
      grossMinor: "64000",
      netMinor: "51200",
      vatMinor: "12800",
    },
    receipt,
  ].entries()) {
    const content = JSON.stringify(row);

    const occurrence = await post(
      book,
      "/source-occurrences",
      {
        sourceSystem: "synthetic-employee-receipts",
        sourceAccountId: employeeId,
        occurrenceKey: key(),
        sourceRevision: "1",
        filename: `receipt-${ordinal}.json`,
        mediaType: "application/json",
        contentBase64: Buffer.from(content).toString("base64"),
      },
      Source.SourceOccurrence,
    );

    const original = await decoded(
      await request(book, `/source-occurrences/${occurrence.id}`),
      Source.SourceOccurrenceView,
    );

    const bytes = Buffer.from(original.contentBase64, "base64");

    if (
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== occurrence.sha256 ||
      bytes.length !== occurrence.byteLength
    )
      throw new Error("Retained original changed before recovery archive capture");
    const objectAdmin = await database();
    let objectKey;

    try {
      objectKey = (
        await objectAdmin.query<{ object_key: string }>(
          "select object_key from openerp.intake_contents where book_id=$1 and sha256=$2",
          [book.bookId, occurrence.sha256],
        )
      ).rows[0]?.object_key;
    } finally {
      await objectAdmin.end();
    }

    if (!objectKey) throw new Error("Retained JSON original has no owned object reference");

    const archive = await fileObjectStore(
      join(await realpath(environment().scratch), "original-objects"),
    );

    await archive.put(objectKey, bytes);

    if (ordinal === 0) {
      const retained = await post(
        book,
        "/evidence",
        {
          title: "Qualified retained receipt",
          mediaType: "application/json",
          origin: "Synthetic R40 verification",
          content,
        },
        A.Evidence,
      );

      const amounts = {
        grossMinor: row.grossMinor,
        netMinor: row.netMinor,
        vatMinor: row.vatMinor,
      };

      taxSource = await post(
        book,
        "/expense-tax/sources",
        {
          sourceKey: `r40_${key().replaceAll("-", "")}`,
          expectedSourceDigest: null,
          facts: {
            evidenceId: retained.id,
            sourceLocator: occurrence.id,
            description: row.purpose,
            recordClass: "synthetic",
            amounts,
            currency: "SEK",
            currencyScale: 2,
            supplierJurisdiction: "SE",
            supplyJurisdiction: "SE",
            issuedOn: row.issuedOn,
            receivedOn: row.issuedOn,
            suppliedOn: row.issuedOn,
            taxPointOn: row.issuedOn,
            changeSetId: null,
            voucherId: null,
          },
        },
        Tax.TaxSourceRevision,
      );
      taxReview = await post(
        reviewer,
        `/expense-tax/sources/${taxSource.sourceId}/reviews`,
        {
          sourceDigest: taxSource.digest,
          expectedReviewDigest: null,
          facts: {
            evidenceId: source.id,
            rationale: "Human review of exact synthetic retained receipt",
            amounts,
            registration: "registered",
            registrationEvidenceId: source.id,
            method: "accrual",
            methodEvidenceId: source.id,
            bookJurisdiction: "SE",
            suppliedOn: row.issuedOn,
            taxPointOn: row.issuedOn,
            dateBasis: "Retained receipt date",
            dateEvidenceId: source.id,
            treatment: "domestic_purchase",
            profileId: "synthetic-expense-tax",
            profileVersion: "1",
            rateNumerator: "1",
            rateDenominator: "4",
            deductionNumerator: "1",
            deductionDenominator: "1",
            deductionBasis: "Synthetic fully deductible office supplies",
            deductionEvidenceId: source.id,
            roundingPolicy: "exact_only",
          },
        },
        Tax.TaxReview,
      );
    }

    items.push({
      occurrenceId: occurrence.id,
      sha256: occurrence.sha256,
      taxSourceId: ordinal === 0 ? (taxSource?.sourceId ?? null) : null,
      taxSourceDigest: ordinal === 0 ? (taxSource?.digest ?? null) : null,
      taxReviewDigest: ordinal === 0 ? (taxReview?.digest ?? null) : null,
    });
  }

  return {
    ...f,
    book,
    reviewer,
    evidence,
    taxSource,
    taxReview,
    receipt,
    submission: {
      claimKey: `claim_${key()}`,
      employeeId,
      month: "2026-01",
      purpose: "Synthetic R40 office supplies and retained exclusions",
      items,
    },
    review: {
      directMinor: "500000",
      expenseAccountId: "claim_expense",
      inputVatAccountId: "claim_vat",
      liabilityAccountId: "claim_liability",
      accountingPeriodId: "period_2026",
      postingDate: "2026-01-15",
      series: "A",
    },
    payee: {
      employeeId,
      employeeRevisionId,
      creditorName: "Synthetic Employee",
      creditorIban: "SE4550000000058398257466",
      creditorBic: "ESSESESS",
      evidence,
      reason: "Retained synthetic employee account",
    },
    file: {
      executionDate: A.swedishBusinessDate(new Date()),
      debtorName: "Synthetic employer",
      debtorIban: "SE4550000000058398257466",
      debtorBic: "ESSESESS",
      reason: "Separate synthetic offline file review",
      acknowledgeOfflineOnly: true,
    },
  };
}
