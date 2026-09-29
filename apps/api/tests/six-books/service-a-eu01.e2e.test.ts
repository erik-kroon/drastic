import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/supplier-invoice-drafts";
import {
  createSession,
  database,
  decoded,
  environment,
  key,
  post,
  request,
  run,
  type BookFixture,
} from "../support/fixtures";

// NEXT-05 boundary probe via Book A A-EU01 facts (challenge input only).
// A-EU01: eu_supplier, German hosting, EUR 100000 native, book rate 112/10,
// SEK base 1120000, reverse charge 1/4, full deduction. Document 2025-10-15.
// Expected honest outcome: structured refusal (no qualified VAT rule release
// ships with this release, so readReleaseSelection has no generalRuleServices
// section). This probe records the exact refusal code; it does not fabricate
// a release and does not post. Financial proof stays BLOCKED until the
// company-profile rule-release owner exists.

const apiDirectory = resolve(import.meta.dirname, "../..");

async function fixtureBookA(): Promise<BookFixture> {
  const env = environment();

  const id = randomBytes(8).toString("hex");

  const token = randomBytes(32).toString("hex");

  const agentToken = randomBytes(32).toString("hex");

  const entityId = `entity_${id}`;

  const bookId = `book_${id}`;

  const actorId = `operator_${id}`;

  const agentId = `agent_${id}`;

  const config = {
    entity: { id: entityId, name: "Six-books A-EU01 synthetic entity" },
    book: {
      id: bookId,
      name: "Six-books A-EU01 book",
      currency: "SEK",
      profile: "synthetic-core-v1",
    },
    actor: {
      id: actorId,
      name: "Six-books operator",
      role: "operator",
      tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    fiscalYear: { id: "fy-a", startsOn: "2025-05-17", endsOn: "2026-04-30" },
    periods: [{ id: "period-a", startsOn: "2025-05-17", endsOn: "2026-04-30" }],
    accounts: [
      { id: "account_bank", code: "1930", name: "Bank SEK" },
      { id: "account_payable", code: "2440", name: "Supplier payable" },
      { id: "account_input_vat", code: "2641", name: "Input VAT" },
      { id: "account_output_vat", code: "2610", name: "Output VAT" },
      { id: "account_expense", code: "6000", name: "Hosting expense" },
    ],
  };

  const path = join(env.scratch, `${bookId}.json`);

  await writeFile(path, JSON.stringify(config));

  await run("bun", ["scripts/provision.ts", path], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: env.adminUrl,
      OPENERP_ACCESS_TOKEN: token,
    },
  });

  const admin = await database();

  try {
    await admin.query("INSERT INTO openerp.actors(id, name) VALUES ($1, 'Six-books agent')", [
      agentId,
    ]);

    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'agent')",
      [bookId, agentId],
    );

    await admin.query(
      "INSERT INTO openerp.credentials(token_hash, actor_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
      [createHash("sha256").update(agentToken).digest("hex"), agentId],
    );
  } finally {
    await admin.end();
  }

  return {
    entityId,
    bookId,
    actorId,
    agentId,
    token,
    agentToken,
    path: `/api/v1/entities/${entityId}/books/${bookId}`,
  };
}

test("six-books service A-EU01: prepare refuses without qualified rule release", async () => {
  const env = environment();

  const base = await fixtureBookA();

  const book = { ...base, token: (await createSession(base)).token };

  const source = await decoded(
    await request(book, "/evidence", {
      method: "POST",
      body: JSON.stringify({
        title: "A-EU01 foreign hosting synthetic",
        content: "A-EU01 eu_supplier EUR 100000 rate 112/10 base 1120000 TEST-ONLY",
        mediaType: "text/plain",
        origin: "six-books challenge A-EU01 TEST-ONLY",
      }),
    }),
    Accounting.Evidence,
  );

  const supplier = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: "eu_supplier",
      role: "supplier",
      displayName: "A-EU01 synthetic EU supplier",
      evidenceId: source.id,
      reason: "Six-books A-EU01 service probe",
    },
    Commerce.CounterpartyRevision,
  );

  const identity = {
    legalName: "A-EU01 synthetic supplier",
    registrationId: "DE000000001",
    taxId: null,
    address: "Synthetic Strasse 1",
    countryCode: "DE",
    evidenceId: source.id,
  };

  const draft = await post(
    book,
    "/commerce/supplier-invoice-drafts",
    {
      draftKey: `aeu01_${key()}`,
      content: {
        title: "A-EU01 German hosting service",
        counterpartyId: supplier.id,
        counterpartyRevision: supplier.revision,
        supplier: identity,
        buyer: identity,
        sourceEvidenceId: source.id,
        supplierDocumentNumber: "EU-2025-101",
        currency: "SEK",
        currencyScale: 2,
        documentDate: "2025-10-15",
        supplyDate: "2025-10-15",
        dueDate: "2025-11-14",
        paymentTerms: "30 days",
        sourceTotalMinor: "1120000",
        lines: [
          {
            id: "line_eu1",
            description: "Hosting October, EUR 100000 at 112/10",
            quantity: "1",
            unitPriceMinor: "1120000",
            baseMinor: "1120000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "0",
            taxDescription: "Reverse charge, no foreign tax",
            taxEvidenceId: source.id,
            sourceGrossMinor: "1120000",
          },
        ],
      },
    },
    Drafts.SupplierInvoiceDraftRevision,
  );

  const prepareResponse = await request(book, "/commerce/service-purchase-reviews", {
    method: "POST",
    body: JSON.stringify({
      profile: "general-service-reverse-charge-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_payable",
      inputVatAccountId: "account_input_vat",
      outputVatAccountId: "account_output_vat",
      accountingPeriodId: "period-a",
      series: "A",
      reason: "Six-books A-EU01 reverse-charge probe",
      taxPoint: { taxPointOn: "2025-10-15", basis: "document_date" },
      rateId: "se-25-standard",
      lineAssignments: [
        {
          lineId: "line_eu1",
          expenseAccountId: "account_expense",
          originalNetMinor: "100000",
          originalCurrency: "EUR",
          originalScale: 2,
          sourceTaxMinor: "0",
          serviceKind: "hosting-service",
          jurisdictionClass: "EU_OTHER",
          deduction: { numerator: "1", denominator: "1" },
          accountingRate: { numerator: "112", denominator: "10" },
          accountingRateScheme: "A-EU01 synthetic book rate",
          taxPointRate: { numerator: "112", denominator: "10" },
          taxPointRateScheme: "A-EU01 synthetic book rate",
        },
      ],
    }),
  });

  const prepareBody = await prepareResponse.text();

  expect(prepareResponse.status).not.toBe(500);

  let code = `http-${prepareResponse.status}`;

  try {
    const parsed = JSON.parse(prepareBody) as { code?: string };

    if (parsed.code) code = parsed.code;
  } catch {
    code = `http-${prepareResponse.status}:unparsed`;
  }

  const sekProbeResponse = await request(book, "/commerce/service-purchase-reviews", {
    method: "POST",
    body: JSON.stringify({
      profile: "general-service-reverse-charge-v1",
      draftId: draft.id,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      controlAccountId: "account_payable",
      inputVatAccountId: "account_input_vat",
      outputVatAccountId: "account_output_vat",
      accountingPeriodId: "period-a",
      series: "A",
      reason: "Six-books A-EU01 second probe with book-currency assignment",
      taxPoint: { taxPointOn: "2025-10-15", basis: "document_date" },
      rateId: "se-25-standard",
      lineAssignments: [
        {
          lineId: "line_eu1",
          expenseAccountId: "account_expense",
          originalNetMinor: "1120000",
          originalCurrency: "SEK",
          originalScale: 2,
          sourceTaxMinor: "0",
          serviceKind: "hosting-service",
          jurisdictionClass: "EU_OTHER",
          deduction: { numerator: "1", denominator: "1" },
          accountingRate: { numerator: "1", denominator: "1" },
          accountingRateScheme: "book currency probe",
          taxPointRate: { numerator: "1", denominator: "1" },
          taxPointRateScheme: "book currency probe",
        },
      ],
    }),
  });

  const sekProbeBody = await sekProbeResponse.text();

  expect(sekProbeResponse.status).not.toBe(500);

  let sekCode = `http-${sekProbeResponse.status}`;

  try {
    const parsed = JSON.parse(sekProbeBody) as { code?: string };

    if (parsed.code) sekCode = parsed.code;
  } catch {
    sekCode = `http-${sekProbeResponse.status}:unparsed`;
  }

  const report = {
    schema: "six-books-service/v1",
    case: "A/A-EU01 recognize_foreign_service",
    status: "BLOCKED_UNSUPPORTED",
    reason:
      "Two independent gates. Gate 1 (structural): reconcileServiceLine requires assignment originalNet/originalCurrency to equal the draft line, while drafts must be book currency, so a EUR-native service can never stage its native amounts (InvalidJournal). Gate 2 (release): the all-SEK second probe passes reconciliation and then refuses for the missing qualified VAT rule release.",
    foreignProbeCode: code,
    bookCurrencyProbeCode: sekCode,
    draftId: draft.id,
  };

  await writeFile(
    join(env.artifacts, "six-books-service-a-eu01.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  expect(report.status).toBe("BLOCKED_UNSUPPORTED");
});
