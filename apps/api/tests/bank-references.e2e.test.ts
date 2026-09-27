import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Issuance from "@open-erp/contracts/invoice-issuance";
import * as Documents from "@open-erp/contracts/invoice-documents";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import {
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  persisted,
  request,
  type BookFixture,
} from "./support/fixtures";

async function payment(book: BookFixture, evidenceId: string, opposite = false) {
  const input = journal(evidenceId);

  const plan = await decoded(
    await request(book, "/change-sets", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        lines: opposite
          ? [
              {
                accountId: "account_bank",
                debitMinor: "0",
                creditMinor: "12500",
                description: "Opposite cash direction",
              },
              {
                accountId: "account_clearing",
                debitMinor: "0",
                creditMinor: "12500",
                description: "Payment control",
              },
              {
                accountId: "account_revenue",
                debitMinor: "25000",
                creditMinor: "0",
                description: "Synthetic balancing entry",
              },
            ]
          : input.lines,
      }),
    }),
    Accounting.ChangeSet,
  );

  const receipt = await execute(book, plan);
  const lines = plan.groups[0]?.actions[0]?.lines;
  const control = lines?.find((line) => line.accountId === "account_clearing");
  const bank = lines?.find((line) => line.accountId === "account_bank");

  if (!control || !bank) throw new Error("The posted payment must retain both line identities.");

  return { receipt, controlLineId: control.lineId, bankLineId: bank.lineId };
}

async function issue(
  book: BookFixture,
  evidenceId: string,
  counterparty: typeof Commerce.CounterpartyRevision.Type,
) {
  const identity = {
    legalName: "Synthetic company",
    registrationId: "SYNTHETIC-ONLY",
    taxId: null,
    address: "Synthetic address, not a real company",
    countryCode: "SE",
    evidenceId,
  };

  const draft = await decoded(
    await request(book, "/commerce/invoice-drafts", {
      method: "POST",
      body: JSON.stringify({
        draftKey: `draft_${key()}`,
        content: {
          title: "Reference comparison fixture",
          counterpartyId: counterparty.id,
          counterpartyRevision: counterparty.revision,
          seller: identity,
          customer: { ...identity, legalName: counterparty.displayName },
          currency: "SEK",
          currencyScale: 2,
          plannedIssueDate: "2026-09-22",
          supplyDate: "2026-09-22",
          dueDate: "2026-10-22",
          paymentTerms: "Synthetic only",
          sourceTotalMinor: "12500",
          lines: [
            {
              id: "line_1",
              description: "Synthetic service",
              quantity: "1",
              unitPriceMinor: "12500",
              baseMinor: "12500",
              discountMinor: "0",
              chargeMinor: "0",
              taxMinor: "0",
              taxDescription: "Synthetic zero tax",
              taxEvidenceId: evidenceId,
              sourceGrossMinor: "12500",
            },
          ],
        },
      }),
    }),
    Drafts.InvoiceDraftRevision,
  );

  const review = await decoded(
    await request(book, "/commerce/invoice-issue-reviews", {
      method: "POST",
      body: JSON.stringify({
        profile: "synthetic-manual-invoice-v1",
        draftId: draft.id,
        expectedRevision: draft.revision,
        expectedDigest: draft.digest,
        controlAccountId: "account_clearing",
        creditAccountId: "account_revenue",
        accountingPeriodId: "period_2026",
        series: "A",
        reason: "Synthetic reference journey",
        acknowledgeSyntheticOnly: true,
      }),
    }),
    Issuance.InvoiceIssueReview,
  );

  const approvalInput = { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true };

  const approval = await decoded(
    await request(book, `/commerce/invoice-issue-reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify(approvalInput),
    }),
    Issuance.InvoiceIssueApproval,
  );

  return decoded(
    await request(book, `/commerce/invoice-issue-reviews/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ ...approvalInput, approvalId: approval.id }),
    }),
    Issuance.InvoiceIssueReceipt,
  );
}

async function allocate(
  book: BookFixture,
  evidenceId: string,
  paid: Awaited<ReturnType<typeof payment>>,
  invoice: typeof Issuance.InvoiceIssueReceipt.Type,
) {
  const plan = await decoded(
    await request(book, "/commerce/allocation-plans", {
      method: "POST",
      body: JSON.stringify({
        voucherId: paid.receipt.voucherId,
        lineId: paid.controlLineId,
        evidenceId,
        rationale: "Synthetic payment linked to its issued invoice",
        allocations: [{ invoiceId: invoice.registerInvoiceId, amountMinor: "12500" }],
      }),
    }),
    Commerce.AllocationPlan,
  );

  const input = { version: 1, planDigest: plan.digest };

  const approval = await decoded(
    await request(book, `/commerce/allocation-plans/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    Commerce.AllocationApproval,
  );

  return decoded(
    await request(book, `/commerce/allocation-plans/${plan.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ ...input, approvalId: approval.id }),
    }),
    Commerce.AllocationReceipt,
  );
}

test("retained invoice references rank bank candidates without granting matching authority", async () => {
  const book = await fixture([{ id: "account_revenue", code: "3001", name: "Synthetic revenue" }]);
  const source = await evidence(book);
  // Post before the register admits the control account. All financial writes use HTTP.
  const first = await payment(book, source.id);
  const second = await payment(book, source.id);
  const opposite = await payment(book, source.id, true);
  const unallocated = await payment(book, source.id);

  const counterparty = await decoded(
    await request(book, "/commerce/counterparties", {
      method: "POST",
      body: JSON.stringify({
        kind: "synthetic_counterparty_v1",
        externalKey: key(),
        role: "customer",
        displayName: "Synthetic customer",
        evidenceId: source.id,
        reason: "Reference fixture",
      }),
    }),
    Commerce.CounterpartyRevision,
  );

  const invoices = [
    await issue(book, source.id, counterparty),
    await issue(book, source.id, counterparty),
    await issue(book, source.id, counterparty),
  ];

  const [invoice1, invoice2, invoice3] = invoices;

  if (!invoice1 || !invoice2 || !invoice3) throw new Error("Three issued invoices are required.");

  const allocations = [
    await allocate(book, source.id, first, invoice1),
    await allocate(book, source.id, second, invoice2),
    await allocate(book, source.id, opposite, invoice3),
  ];

  const document = await decoded(
    await request(book, "/commerce/invoice-documents", {
      method: "POST",
      body: JSON.stringify({
        issueId: invoice1.id,
        issueDigest: invoice1.digest,
        generatorVersion: Documents.invoiceDocumentGenerator,
      }),
    }),
    Documents.InvoiceDocumentView,
  );

  if (!document.artifact) throw new Error("The invoice document must be rendered.");

  const html = Buffer.from(document.artifact.contentBase64, "base64").toString("utf8");
  expect(html).toContain(`<strong>${invoice1.internalDocumentNumber}</strong>`);

  const reference = {
    kind: "invoice_document_number",
    issuerNamespace: "entity",
    issuerId: book.entityId,
    value: invoice1.internalDocumentNumber,
    sourceField: "dedicated_reference",
  };

  const references = [
    reference,
    { ...reference, sourceField: "free_text" },
    { ...reference, kind: "ocr" },
    { ...reference, issuerId: "another_entity" },
    null,
    { ...reference, value: invoice3.internalDocumentNumber },
    { ...reference, value: invoice1.internalDocumentNumber.replace("-", "") },
    { ...reference, value: "SYN-01" },
  ];

  const statementSource = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: "100000",
    completeness: { declaredComplete: false, basis: "Synthetic comparison rows only" },
    rows: references.map((ref, index) => ({
      rowOrdinal: index + 1,
      providerId: index === 4 ? invoice1.internalDocumentNumber : null,
      date: "2026-09-22",
      description: invoice1.internalDocumentNumber,
      amountMinor: "12500",
      ...(ref === null ? {} : { paymentReference: ref }),
    })),
  };

  const statementEvidence = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "Synthetic statement",
        mediaType: "application/json",
        content: JSON.stringify(statementSource),
        origin: "FWD-06 E2E",
      }),
    }),
    Accounting.Evidence,
  );

  const imported = await decoded(
    await request(book, "/bank-statements", {
      method: "POST",
      body: JSON.stringify({
        ...statementSource,
        evidenceId: statementEvidence.id,
        existingMatches: [],
      }),
    }),
    Bank.StatementImportReceipt,
  );

  const statementId = imported.statement.id;
  const before = await persisted(book);
  const reports = [];

  for (let rowOrdinal = 1; rowOrdinal <= references.length; rowOrdinal += 1) {
    reports.push(
      await decoded(
        await request(book, "/bank-match-candidates", {
          method: "POST",
          body: JSON.stringify({ statementId, rowOrdinal }),
        }),
        Candidates.BankMatchCandidates,
      ),
    );
  }

  const matched = reports[0];

  if (!matched) throw new Error("Candidate report is required.");

  expect(matched.candidates[0]?.voucherId).toBe(first.receipt.voucherId);
  expect(matched.candidates[0]?.lineId).toBe(first.bankLineId);
  expect(matched.candidates[0]?.eligible).toBe(true);
  expect(matched.candidates[0]?.amountMinor).toBe(matched.source.amountMinor);
  expect(matched.candidates[0]?.referenceComparison).toBe("match");
  expect(
    matched.candidates.find((candidate) => candidate.voucherId === second.receipt.voucherId)
      ?.referenceComparison,
  ).toBe("mismatch");
  expect(
    matched.candidates.find((candidate) => candidate.voucherId === unallocated.receipt.voucherId)
      ?.referenceComparison,
  ).toBe("unavailable");
  expect(matched.identityEstablished).toBe(false);
  expect(matched.candidates[0]?.referenceEvidence[0]?.value).toBe(invoice1.internalDocumentNumber);
  expect(matched.candidates[0]?.referenceEvidence[0]?.invoiceId).toBe(invoice1.registerInvoiceId);

  for (const index of [1, 2, 3, 4, 6, 7]) {
    expect(
      reports[index]?.candidates.some((candidate) => candidate.referenceComparison === "match"),
    ).toBe(false);
  }

  const wrongSign = reports[5]?.candidates.find(
    (candidate) => candidate.voucherId === opposite.receipt.voucherId,
  );

  expect(wrongSign?.referenceComparison).toBe("match");
  expect(wrongSign?.eligible).toBe(false);
  expect(wrongSign?.blockedReasons).toContain("opposite_sign");
  expect(await persisted(book)).toEqual(before);

  const repeated = await decoded(
    await request(book, "/bank-match-candidates", {
      method: "POST",
      body: JSON.stringify({ statementId, rowOrdinal: 1, previousDigest: matched.digest }),
    }),
    Candidates.BankMatchCandidates,
  );

  expect(repeated.previousDigestMatches).toBe(true);
  const outsider = await fixture();
  await failure(
    await request(book, "/bank-match-candidates", {
      method: "POST",
      headers: { authorization: `Bearer ${outsider.agentToken}` },
      body: JSON.stringify({ statementId, rowOrdinal: 1 }),
    }),
    403,
    "Forbidden",
  );
  await failure(
    await request(book, "/bank-statements", {
      method: "POST",
      body: JSON.stringify({
        ...statementSource,
        currency: "EUR",
        evidenceId: statementEvidence.id,
        existingMatches: [],
      }),
    }),
    422,
    "InvalidJournal",
  );

  await failure(
    await request(book, "/bank-matches", {
      method: "POST",
      body: JSON.stringify({
        statementId,
        rowOrdinal: 6,
        voucherId: opposite.receipt.voucherId,
        lineId: opposite.bankLineId,
      }),
    }),
    422,
    "InvalidJournal",
  );

  const matchInput = {
    statementId,
    rowOrdinal: 1,
    voucherId: first.receipt.voucherId,
    lineId: first.bankLineId,
  };

  await writeFile(
    join(environment().artifacts, "bank-reference-candidates.json"),
    JSON.stringify({ reports, matchInput, repeated }, null, 2),
  );

  const matchReceipt = await decoded(
    await request(book, "/bank-matches", {
      method: "POST",
      body: JSON.stringify(matchInput),
    }),
    Bank.BankMatchReceipt,
  );

  const afterMatch = await decoded(
    await request(book, "/bank-match-candidates", {
      method: "POST",
      body: JSON.stringify({ statementId, rowOrdinal: 1, previousDigest: matched.digest }),
    }),
    Candidates.BankMatchCandidates,
  );

  expect(afterMatch.previousDigestMatches).toBe(false);
  expect(afterMatch.source.blockedReasons).toContain("source_no_capacity");
  expect(afterMatch.candidates.every((candidate) => !candidate.eligible)).toBe(true);

  const secondRow = await decoded(
    await request(book, "/bank-match-candidates", {
      method: "POST",
      body: JSON.stringify({ statementId, rowOrdinal: 2 }),
    }),
    Candidates.BankMatchCandidates,
  );

  expect(secondRow.source.remainingMinor).toBe("12500");
  expect(
    secondRow.candidates.find((candidate) => candidate.voucherId === second.receipt.voucherId)
      ?.remainingMinor,
  ).toBe("12500");
  const matchKey = key();

  const secondMatch = {
    statementId,
    rowOrdinal: 2,
    voucherId: second.receipt.voucherId,
    lineId: second.bankLineId,
  };

  const concurrent = await Promise.all(
    [0, 1].map(async () =>
      decoded(
        await request(book, "/bank-matches", {
          method: "POST",
          headers: { "idempotency-key": matchKey },
          body: JSON.stringify(secondMatch),
        }),
        Bank.BankMatchReceipt,
      ),
    ),
  );

  expect(concurrent[0]).toEqual(concurrent[1]);
  await failure(
    await request(book, "/bank-matches", {
      method: "POST",
      headers: { "idempotency-key": matchKey },
      body: JSON.stringify({ ...secondMatch, rowOrdinal: 3 }),
    }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(book, "/bank-matches", {
      method: "POST",
      body: JSON.stringify({ ...secondMatch, rowOrdinal: 3 }),
    }),
    422,
    "InvalidJournal",
  );

  await writeFile(
    join(environment().artifacts, "bank-reference-journey.json"),
    JSON.stringify(
      {
        scope: { entityId: book.entityId, bookId: book.bookId },
        invoices,
        allocations,
        document: document.artifact,
        statement: imported,
        reports,
        repeated,
        matchReceipt,
        afterMatch,
        secondRow,
        concurrent,
        limits:
          "Synthetic invoice document numbers and committed commerce allocations; no OCR or provider qualification.",
      },
      null,
      2,
    ),
  );
}, 60000);
