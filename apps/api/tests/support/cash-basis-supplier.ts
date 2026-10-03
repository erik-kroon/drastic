import { expect } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { createDraft } from "./supplier-review";
import { database, evidence, fixture, key, post, journal, execute } from "./fixtures";

export async function supplierOpeningFixture(today: string) {
  const amounts = ["-4000"];
  const invoiceMinor = "10000";
  const providerId = null;
  const book = await fixture([{ id: "account_expense", code: "4010", name: "Synthetic expense" }]);
  const independent = await fixture();
  const reviewer = { ...book, actorId: independent.actorId, token: independent.token };
  const source = await evidence(book);
  const admin = await database();
  const releaseId = "synthetic_supplier_settlement_accrual_v1";

  const release = {
    id: releaseId,
    jurisdiction: "ZZ",
    family: "posting_eligibility",
    version: 1,
    checksum: `sha256:${"b".repeat(64)}`,
    applicability: {
      legalForms: [],
      accountingMethods: ["accrual"],
      vatRegistrations: [],
      payrollRegistrations: [],
    },
    requiredFactKinds: ["accounting_method"],
    requiredRoleKinds: ["bank", "commerce"],
    calculatorVersion: "synthetic-supplier-settlement-accrual-v1",
    rounding: { mode: "half_up", scale: 2 },
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    sourceManifest:
      "Independent synthetic accrual settlement oracle, no company or statutory claim",
    qualificationStatus: "reviewed",
    recordClasses: ["synthetic"],
  };

  try {
    await admin.query(
      "insert into openerp_auth.\"user\"(id,name,email) values($1,'Synthetic reviewer',$2) on conflict(id) do nothing",
      [reviewer.actorId, `${reviewer.actorId}@e2e.invalid`],
    );
    await admin.query(
      "insert into openerp.identity_admissions(actor_id,provider_id,subject,enabled) values($1,'e2e-supplier',$1,true)",
      [reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'ZZ','posting_eligibility',1,$2,$3) on conflict(id) do nothing",
      [releaseId, release.checksum, release],
    );
  } finally {
    await admin.end();
  }

  const facts: Array<typeof Profiles.FactRevision.Type> = [];

  for (const declaration of [
    { factKind: "jurisdiction", value: { state: "known", value: "ZZ" } },
    { factKind: "accounting_method", value: { state: "known", value: "accrual" } },
  ]) {
    const fact = await post(
      book,
      "/company-facts",
      {
        ...declaration,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Synthetic confirmed fact",
      },
      Profiles.FactRevision,
    );

    facts.push(fact);

    await post(
      reviewer,
      `/company-facts/${fact.id}/reviews`,
      {
        factRevisionId: fact.id,
        expectedDigest: fact.digest,
        result: "confirmed",
        rationale: "Independent synthetic review",
      },
      Profiles.FactReview,
    );
  }

  for (const [roleKind, accountId] of [
    ["bank", "account_bank"],
    ["commerce", "account_clearing"],
  ]) {
    await post(
      book,
      "/company-role-bindings",
      {
        roleKind,
        accountId,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        reviewer: reviewer.actorId,
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Synthetic reviewed role",
      },
      Profiles.RoleBinding,
    );
  }

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Synthetic settlement supplier",
      evidenceId: source.id,
      reason: "Independent settlement fixture",
    },
    Commerce.CounterpartyRevision,
  );

  const identity = {
    legalName: "Synthetic identity",
    registrationId: "5560000000",
    taxId: null,
    address: "Synthetic street 1",
    countryCode: "SE",
    evidenceId: source.id,
  };

  const draft = await createDraft(book, {
    title: "Synthetic accrued purchase",
    counterpartyId: supplier.id,
    counterpartyRevision: supplier.revision,
    supplier: identity,
    buyer: identity,
    sourceEvidenceId: source.id,
    supplierDocumentNumber: `SETTLEMENT-${key()}`,
    currency: "SEK",
    currencyScale: 2,
    documentDate: "2026-09-22",
    supplyDate: "2026-09-22",
    dueDate: "2026-10-22",
    paymentTerms: "30 days",
    sourceTotalMinor: invoiceMinor,
    lines: [
      {
        id: "line_purchase",
        description: "Synthetic service",
        quantity: "1",
        unitPriceMinor: invoiceMinor,
        baseMinor: invoiceMinor,
        discountMinor: "0",
        chargeMinor: "0",
        taxMinor: "0",
        taxDescription: "Synthetic zero tax",
        taxEvidenceId: source.id,
        sourceGrossMinor: invoiceMinor,
      },
    ],
  });

  const review = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    {
      profile: "synthetic-gross-cost-supplier-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_expense",
      accountingPeriodId: "period_2026",
      series: "A",
      reason: "Synthetic already accrued invoice",
      acknowledgeSyntheticOnly: true,
    },
    Acceptance.SupplierAcceptanceReview,
  );

  const acceptanceInput = { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true };

  const approval = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    acceptanceInput,
    Acceptance.SupplierAcceptanceApproval,
  );

  const acceptance = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/execute`,
    { ...acceptanceInput, approvalId: approval.id },
    Acceptance.SupplierAcceptanceReceipt,
  );

  const fundingSource = await post(
    book,
    "/evidence",
    {
      title: "Independent synthetic opening funding100000",
      content: JSON.stringify({
        kind: "synthetic_opening_funding",
        accountId: "account_bank",
        date: "2026-09-22",
        amountMinor: "100000",
        purpose: "Separate source from supplier purchase acceptance",
      }),
      mediaType: "application/json",
      origin: "P10 independently specified funding document",
    },
    Accounting.Evidence,
  );

  expect(fundingSource.id).not.toBe(source.id);
  expect(fundingSource.sha256).not.toBe(source.sha256);

  const funding = await post(
    book,
    "/change-sets",
    {
      ...journal(fundingSource.id, "100000"),
      postingDate: "2026-09-22",
      lines: [
        {
          accountId: "account_bank",
          debitMinor: "100000",
          creditMinor: "0",
          description: "Independent opening funding",
        },
        {
          accountId: "account_expense",
          debitMinor: "0",
          creditMinor: "100000",
          description: "Synthetic funding offset",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  await execute(book, funding);

  const declaration = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: today,
    endsOn: today,
    openingMinor: "100000",
    closingMinor: "96000",
    completeness: {
      declaredComplete: true,
      basis: "Independent current opening100000 less observed4000 leaves96000",
    },
    rows: amounts.map((amountMinor, index) => ({
      rowOrdinal: index + 1,
      providerId,
      date: today,
      description: "Synthetic supplier payment",
      amountMinor,
    })),
  };

  const bankEvidence = await post(
    book,
    "/evidence",
    {
      title: "Synthetic original bank source",
      content: JSON.stringify(declaration),
      mediaType: "application/json",
      origin: "Independent settlement fixture",
    },
    Accounting.Evidence,
  );

  const statementInput = { ...declaration, evidenceId: bankEvidence.id, existingMatches: [] };

  const statement = await post(
    book,
    "/bank-statements",
    statementInput,
    Bank.StatementImportReceipt,
  );

  const input = {
    invoiceId: acceptance.registerInvoiceId,
    statementId: statement.statement.id,
    rowOrdinal: 1,
    rationale: "Observed whole synthetic supplier debit",
    evidence: { evidenceId: bankEvidence.id, sha256: bankEvidence.sha256 },
  };

  return { book, reviewer, acceptance, bankEvidence, statement, statementInput, input, facts };
}
