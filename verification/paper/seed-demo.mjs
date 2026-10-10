import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Match } from "effect";

const { chromium } = createRequire(import.meta.resolve("e2e"))("playwright");

const invoiceFont = (
  await readFile(new URL("../../apps/web/public/fonts/InterVariable.woff2", import.meta.url))
).toString("base64");

export const demoModes = ["demo", "worst", "empty", "one", "many"];

export const demoAccounts = [
  { id: "demo_consulting", code: "6550", name: "Konsultarvoden" },
  { id: "demo_vat", code: "2641", name: "Debiterad ingående moms" },
  { id: "demo_payable", code: "2440", name: "Leverantörsskulder" },
  { id: "demo_receivable", code: "1510", name: "Kundfordringar" },
  { id: "demo_revenue", code: "3041", name: "Försäljning tjänster, 25 % moms" },
  { id: "demo_output_vat", code: "2611", name: "Utgående moms, 25 %" },
];

const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const money = (minor) => {
  const amount = BigInt(minor);

  return `${(amount / 100n).toLocaleString("sv-SE")},${(amount % 100n).toString().padStart(2, "0")}`;
};

async function original(page, invoice) {
  const rows = invoice.lines
    .map(
      (line) =>
        `<tr><td>${escape(line.description)}</td><td>${escape(line.quantity)} tim</td><td>${money(line.unitPriceMinor)}</td><td>${money(line.baseMinor)}</td></tr>`,
    )
    .join("");

  const net = invoice.lines.reduce((sum, line) => sum + BigInt(line.baseMinor), 0n).toString();

  const tax = invoice.lines
    .reduce((sum, line) => sum + BigInt(line.taxMinor ?? "0"), 0n)
    .toString();

  await page.setContent(
    `<!doctype html><html lang="sv"><meta charset="utf-8"><style>
    @font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${invoiceFont}) format("woff2"); }
    @page { size: 532pt 720pt; margin: 0; } * { box-sizing: border-box; }
    body { margin: 0; padding: 36pt 24pt; min-height: 720pt; display: flex; flex-direction: column; gap: 16pt; color: #0f172a; font: 13pt/20pt Inter, sans-serif; overflow-wrap: anywhere; }
    header { display: flex; justify-content: space-between; gap: 16pt; }
    header > div { min-width: 0; } h1 { font-size: 22pt; font-weight: 600; line-height: 28pt; margin: 0; } h2 { font-size: 26pt; font-weight: 600; line-height: 32pt; margin: 0; flex-shrink: 0; white-space: nowrap; }
    p { margin: 0; } .muted { color: #475569; font-size: 12pt; line-height: 18pt; }
    .facts { display: flex; flex-wrap: wrap; gap: 16pt; } .facts .muted { font-size: 13pt; line-height: 20pt; }
    table { width: 100%; border-collapse: collapse; border-top: 1px solid #cdd5e1; }
    th { color: #475569; font-size: 12pt; line-height: 16pt; font-weight: normal; padding: 16pt 0; text-align: left; }
    td { font-size: 14pt; line-height: 18pt; padding: 0 0 16pt; } td:not(:first-child), th:not(:first-child) { text-align: right; }
    .totals { margin-top: auto; border-top: 1px solid #cdd5e1; padding-top: 16pt; display: flex; flex-direction: column; gap: 16pt; }
    .total { display: flex; justify-content: flex-end; gap: 40pt; font-size: 13pt; line-height: 16pt; }
    .total span:last-child { min-width: 100pt; text-align: right; }
    .total strong { font-size: 16pt; font-weight: 600; line-height: 20pt; }
    footer { font-size: 12pt; line-height: 16pt; color: #475569; }
    </style><header><div><h1>${escape(invoice.supplier)}</h1><p class="muted">Hamngatan 4, 831 30 Östersund</p><p class="muted">Org.nr 556871-0000</p></div><h2>Faktura</h2></header>
    <div class="facts"><div><p class="muted">Fakturanummer</p><p>${escape(invoice.number)}</p></div><div><p class="muted">Fakturadatum</p><p>18 sep 2026</p></div><div><p class="muted">Förfallodatum</p><p>2 okt 2026</p></div><div><p class="muted">Er referens</p><p>Elin Sund</p></div></div>
    <div class="buyer"><p>Fjällby Konsult AB</p><p>Fjällgatan 4, 831 30 Östersund</p></div>
    <table><thead><tr><th>Beskrivning</th><th>Antal</th><th>À-pris</th><th>Belopp</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals"><div class="total muted"><span>Summa exkl. moms</span><span>${money(net)}</span></div><div class="total muted"><span>Moms 25 %</span><span>${money(tax)}</span></div><div class="total"><strong>Att betala</strong><strong>${money(invoice.gross)} SEK</strong></div></div>
    <footer>Betalas senast 2 oktober 2026. Bankgiro 555-0001. Syntetiskt visningsunderlag.</footer></html>`,
    { waitUntil: "load" },
  );
  await page.evaluate(() => document.fonts.ready);

  return page.pdf({ preferCSSPageSize: true, printBackground: true });
}

export async function seedDemo(config) {
  const { fixture, artifacts, mode } = config;

  if (!demoModes.includes(mode)) throw new Error("Unknown demo mode");
  const origin = new URL(config.apiUrl);

  if (
    origin.hostname !== "127.0.0.1" ||
    origin.protocol !== "http:" ||
    fixture.book.id !== "book_synthetic"
  )
    throw new Error("Demo seed requires the disposable synthetic runtime");
  const workspace = `/entities/${fixture.entity.id}/books/${fixture.book.id}`;
  const base = `${origin.origin}/api/v1${workspace}`;

  async function call(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        origin: origin.origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "x-openerp-test-now": config.testNow,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Demo seed ${path}: HTTP ${response.status} ${error.code ?? ""}`);
    }

    return response.json();
  }

  const obligations = await call("/bureau-obligations");

  if (obligations.checkedAt !== config.testNow)
    throw new Error("Demo application clock was not pinned to the board instant");

  const result = {
    mode,
    synthetic: true,
    clockPinned: false,
    boardMoment: "2026-10-02T08:54:00+02:00",
    applicationClock: obligations.checkedAt,
    limitations: [
      "Effect application reads use the board instant; browser, database, ingestion, proposal, approval and receipt timestamps remain real.",
      "The bureau actor is Elin Sund; Sara Lind and illustrated agent activity are not fabricated.",
      "Board-only combined approval/posting, return and reject operations remain unsupported.",
      "Customer invoice is a synthetic register record backed by a posted receivable, not legal issuance.",
      "Complete source coverage, locked result comparison and illustrated actor activity are not fabricated.",
    ],
    limits: {
      minorDigits: 38,
      filename: 200,
      supplierName: 200,
      supplierNumber: 128,
      invoiceLines: 50,
      bankRows: 10000,
      supplierDraftPage: 200,
      attentionPage: 50,
      createdCompaniesPerActor: 2000,
      firmClients: 2000,
    },
    reviews: [],
    boards: {
      "K-10": {
        route: `${workspace}/`,
        state: mode === "empty" ? "empty" : "populated, first supplier selected",
      },
      "K-08": { route: `${workspace}/overview`, state: "route default, partial fixture" },
      "K-20": {
        route: `${workspace}/accounts?account=account_bank&from=2026-09-01&to=2026-10-02`,
        state: mode === "empty" ? "empty" : "bank rows",
      },
    },
  };

  if (mode === "empty") {
    await writeFile(join(artifacts, "demo-seed.json"), `${JSON.stringify(result, null, 2)}\n`);

    return result;
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      extraHTTPHeaders: { "x-openerp-test-now": config.testNow },
    });

    const login = await page.context().request.post(`${origin.origin}/api/auth/sign-in/email`, {
      headers: { origin: config.webUrl },
      data: { email: config.email, password: config.password },
    });

    if (!login.ok()) throw new Error(`Demo operator sign-in: HTTP ${login.status()}`);

    const operator = async (path, body) => {
      const response = await page
        .context()
        .request.fetch(`${origin.origin}/api/v1${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { origin: config.webUrl, "idempotency-key": randomUUID() },
          data: body,
          timeout: path.endsWith("/portfolio") ? 120000 : 30000,
        })
        .catch(() => {
          // Playwright request errors include session cookies; never publish them.
          throw new Error(`Demo operator ${path}: request failed`);
        });

      if (!response.ok()) throw new Error(`Demo operator ${path}: HTTP ${response.status()}`);

      return response.json();
    };

    const firm = await operator("/firms", { name: "Byrå Nordlund" });

    const clients = Match.value(mode).pipe(
      Match.when("one", () => 1),
      Match.when("demo", () => 3),
      Match.orElse(() => 1284),
    );

    const names =
      mode === "worst"
        ? [fixture.book.name, "Aleksandra Wiśniewska-Kowalczyk Redovisningsbyrå AB", "Jo AB"]
        : [fixture.book.name, "Norra Kajen Café AB", "Sjöstrand Design AB"];

    for (let index = 0; index < clients; index++) {
      const company =
        index === 0
          ? { scope: { entityId: fixture.entity.id, bookId: fixture.book.id } }
          : await operator("/companies", {
              name: names[index] ?? `Skogsbo Förvaltning ${index + 1} AB`,
            });

      await operator(`/firms/${firm.firmId}/clients`, {
        scope: company.scope,
        leadId: index % 2 === 0 ? fixture.actor.id : null,
        nextReviewOn: "2026-10-12",
        note: "Syntetisk byråklient",
        expectedRevision: 0,
      });
    }

    const portfolioReadStarted = performance.now();
    const portfolio = await operator(`/firms/${firm.firmId}/portfolio`);

    if (portfolio.workspace.clients.length !== clients)
      throw new Error("Demo portfolio readback differs from retained clients");
    result.portfolio = {
      firmId: firm.firmId,
      retainedClients: clients,
      readDurationMs: Math.round(performance.now() - portfolioReadStarted),
    };
    result.boards["K-09"] = {
      route: `/firms?firm=${firm.firmId}&tab=clients`,
      state: "permitted clients, first selected; incomplete company observations",
      readyText: `1–${Math.min(15, clients)} av ${clients} klienter`,
    };

    async function prepare(invoice, reviewed = true) {
      const bytes = await original(page, invoice);

      const occurrence = await call("/source-occurrences", {
        destination: "supplier_inbox",
        sourceSystem: "synthetic-demo",
        sourceAccountId: "supplier",
        occurrenceKey: randomUUID(),
        sourceRevision: "1",
        filename: invoice.filename,
        mediaType: "application/pdf",
        contentBase64: bytes.toString("base64"),
      });

      const evidence = await call("/evidence", {
        title: invoice.filename,
        mediaType: "application/json",
        origin: "Syntetiskt visningsunderlag",
        content: JSON.stringify({
          kind: "supplier_invoice_source_v1",
          source: {
            occurrenceId: occurrence.id,
            sha256: occurrence.sha256,
            filename: invoice.filename,
          },
        }),
      });

      const party = await call("/commerce/counterparties", {
        kind: "synthetic_counterparty_v1",
        externalKey: randomUUID(),
        role: "supplier",
        displayName: invoice.supplier,
        evidenceId: evidence.id,
        reason: "Syntetiskt visningsunderlag",
      });

      const identity = {
        legalName: invoice.supplier,
        registrationId: null,
        taxId: null,
        address: null,
        countryCode: "SE",
        evidenceId: evidence.id,
      };

      const content = {
        title: `${invoice.supplier}, faktura ${invoice.number}`,
        counterpartyId: party.id,
        counterpartyRevision: party.revision,
        supplier: identity,
        buyer: { ...identity, legalName: fixture.book.name },
        sourceEvidenceId: evidence.id,
        supplierDocumentNumber: invoice.number,
        currency: "SEK",
        currencyScale: 2,
        documentDate: "2026-09-18",
        supplyDate: "2026-09-18",
        dueDate: "2026-10-02",
        paymentTerms: reviewed ? "14 dagar" : null,
        sourceTotalMinor: invoice.gross,
        lines: invoice.lines.map((line, index) => ({
          id: `demo_line_${index}`,
          ...line,
          discountMinor: "0",
          chargeMinor: "0",
          taxDescription: line.taxMinor === null ? null : "Moms 25 %",
          taxEvidenceId: line.taxMinor === null ? null : evidence.id,
          sourceGrossMinor:
            line.taxMinor === null
              ? null
              : (BigInt(line.baseMinor) + BigInt(line.taxMinor)).toString(),
        })),
      };

      const handoff = await call(`/commerce/supplier-inbox/${occurrence.id}/review`, {
        draft: { draftKey: `demo_${randomUUID()}`, content },
        reviewReason: "Syntetiskt granskat original",
        reviewAttemptId: null,
      });

      if (!reviewed) return { draftId: handoff.draft.id, occurrenceId: occurrence.id };

      const review = await call("/commerce/supplier-acceptance-reviews", {
        profile: "swedish-purchase-v1",
        draftId: handoff.draft.id,
        expectedRevision: handoff.draft.revision,
        expectedDigest: handoff.draft.digest,
        controlAccountId: "demo_payable",
        accountingPeriodId: fixture.periods[0].id,
        series: "A",
        reason: "Syntetiskt granskat original",
        acknowledgeSyntheticOnly: true,
        taxPoint: { taxPointOn: "2026-09-18", basis: "document_date" },
        lineAssignments: content.lines.map((line) => ({
          lineId: line.id,
          expenseAccountId: "demo_consulting",
          treatment: {
            basis: "full_deduction",
            rate: { numerator: "25", denominator: "100" },
            deduction: { numerator: "1", denominator: "1" },
            invoiceTaxRounding: "half_up",
            deductionRounding: "half_up",
            acceptancePolicy: "exact_match",
            toleranceMinor: "0",
          },
        })),
      });

      return {
        draftId: handoff.draft.id,
        occurrenceId: occurrence.id,
        reviewId: review.id,
        planId: review.postingPlan.id,
        planDigest: review.postingPlan.planDigest,
        reviewDigest: review.digest,
        expectedGrossMinor: invoice.gross,
      };
    }

    const nordhamn = {
      supplier:
        mode === "worst"
          ? "Aleksandra Wiśniewska-Kowalczyk Redovisningsbyrå AB"
          : "Nordhamn Studio AB",
      number: "1048",
      filename:
        mode === "worst"
          ? "IMG_20250914_183022_HDR_portrait_edited_edited.HEIC.pdf"
          : "1048_nordhamn.pdf",
      gross: "1250000",
      lines: [
        {
          description: "Konceptutveckling, september",
          quantity: "8",
          unitPriceMinor: "75000",
          baseMinor: "600000",
          taxMinor: "150000",
        },
        {
          description: "Layout och originalarbete",
          quantity: "4",
          unitPriceMinor: "75000",
          baseMinor: "300000",
          taxMinor: "75000",
        },
        {
          description: "Bildbehandling",
          quantity: "2",
          unitPriceMinor: "50000",
          baseMinor: "100000",
          taxMinor: "25000",
        },
      ],
    };

    const first = await prepare(nordhamn);
    result.reviews.push(first);
    result.boards["K-11"] = {
      route: `${workspace}/reviews/${first.planId}/${first.planDigest}?sort=oldest`,
      state: "ready to approve",
      readyText: "Attestera bokföring",
    };

    if (mode !== "one") {
      await prepare(
        {
          supplier: "Vinter & Co AB",
          number: "882",
          filename: "882_vinter.pdf",
          gross: "249000",
          lines: [
            {
              description: "Konsultarvode",
              quantity: "1",
              unitPriceMinor: "249000",
              baseMinor: "249000",
              taxMinor: null,
            },
          ],
        },
        false,
      );
      const count = mode === "many" ? 1001 : 1;
      const image = await page.screenshot({ type: "jpeg" });

      for (let index = 0; index < count; index++) {
        const filename =
          mode === "worst"
            ? "IMG_20250914_183022_HDR_portrait_edited_edited.HEIC"
            : index === 0
              ? "Skannad_bild_0931.jpg"
              : `Skannad_bild_${index}.jpg`;

        await call("/source-occurrences", {
          destination: "supplier_inbox",
          sourceSystem: "synthetic-demo",
          sourceAccountId: "supplier",
          occurrenceKey: randomUUID(),
          sourceRevision: "1",
          filename,
          mediaType: "image/jpeg",
          contentBase64: image.toString("base64"),
        });
      }

      if (mode === "worst") {
        for (const [supplier, gross, description] of [
          ["Jo AB", "99999999999999999999999999999999999999", "<script>alert(1)</script> &amp;"],
          ["Đặng Thị Ngọc Hân", "0", "Kostnadsfritt underlag"],
        ]) {
          await prepare(
            {
              supplier,
              number: "1",
              filename: `${supplier}.pdf`,
              gross,
              lines: [
                {
                  description,
                  quantity: "1",
                  unitPriceMinor: gross,
                  baseMinor: gross,
                  taxMinor: "0",
                },
              ],
            },
            false,
          );
        }
      }
    }

    if (mode === "demo") {
      const evidence = await call("/evidence", {
        title: "Kundfaktura F-2026-0038",
        content: "Syntetisk kundfordran. 15000 SEK plus 3750 SEK moms, totalt 18750 SEK.",
        mediaType: "text/plain",
        origin: "Syntetiskt visningsunderlag",
      });

      const party = await call("/commerce/counterparties", {
        kind: "synthetic_counterparty_v1",
        externalKey: randomUUID(),
        role: "customer",
        displayName: "Björkdalen Skogsförvaltning AB",
        evidenceId: evidence.id,
        reason: "Syntetiskt visningsunderlag",
      });

      const plan = await call("/change-sets", {
        kind: "manual_journal",
        evidenceId: evidence.id,
        eventKey: randomUUID(),
        accountingPeriodId: fixture.periods[0].id,
        series: "A",
        postingDate: "2026-08-14",
        description: "Kundfaktura F-2026-0038",
        rationale: "Syntetiskt visningsunderlag",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "demo_receivable",
            debitMinor: "1875000",
            creditMinor: "0",
            description: "Kundfordran",
          },
          {
            accountId: "demo_revenue",
            debitMinor: "0",
            creditMinor: "1500000",
            description: "Tjänster",
          },
          {
            accountId: "demo_output_vat",
            debitMinor: "0",
            creditMinor: "375000",
            description: "Utgående moms",
          },
        ],
      });

      const exact = { version: plan.version, planDigest: plan.planDigest };
      const approval = await call(`/change-sets/${plan.id}/approvals`, exact);

      const receipt = await call(`/change-sets/${plan.id}/execute`, {
        ...exact,
        approvalId: approval.id,
      });

      const line = plan.groups[0].actions[0].lines.find(
        (item) => item.accountId === "demo_receivable",
      );

      result.customer = await call("/commerce/invoices", {
        kind: "synthetic_invoice_v1",
        direction: "customer",
        counterpartyId: party.id,
        counterpartyRevision: party.revision,
        documentNumber: "F-2026-0038",
        issuedOn: "2026-08-14",
        dueOn: "2026-09-13",
        currency: "SEK",
        amountMinor: "1875000",
        controlAccountId: "demo_receivable",
        recognitionVoucherId: receipt.voucherId,
        recognitionLineId: line.lineId,
        evidenceId: evidence.id,
        description: "Kundfaktura F-2026-0038, Björkdalen Skogsförvaltning AB",
      });
    }

    const bankRows = Array.from(
      {
        length: Match.value(mode).pipe(
          Match.when("many", () => 1001),
          Match.when("worst", () => 3),
          Match.orElse(() => 1),
        ),
      },
      (_, index) => ({
        rowOrdinal: index + 1,
        providerId: null,
        date: "2026-09-28",
        description: index === 0 ? "Utbetalning 28 sep" : `Utbetalning ${index + 1}`,
        amountMinor:
          mode === "worst" && index === 2
            ? "-99999999999999999999999999999999999999"
            : index === 0
              ? "-875000"
              : "0",
      }),
    );

    result.bankStatements = [];
    let opening = mode === "worst" ? 875000n : 0n;

    // Each full source must fit the 65536-character evidence boundary. Distinct
    // days avoid overlapping statement coverage for the same retained account.
    for (let offset = 0; offset < bankRows.length; offset += 250) {
      const date = `2026-09-${String(1 + offset / 250).padStart(2, "0")}`;

      const rows = bankRows.slice(offset, offset + 250).map((row, index) => ({
        ...row,
        rowOrdinal: index + 1,
        date: mode === "many" ? date : row.date,
        amountMinor:
          mode === "many" && offset + index > 0
            ? String(-10000 * (1 + ((offset + index) % 7)))
            : row.amountMinor,
      }));

      const closing = rows.reduce((total, row) => total + BigInt(row.amountMinor), opening);

      const statement = {
        kind: "synthetic_bank_statement_v1",
        statementIdentifier: `demo_${randomUUID()}`,
        sourceBankAccountId: "demo_bank",
        accountId: "account_bank",
        currency: "SEK",
        startsOn: mode === "many" ? date : "2026-09-01",
        endsOn: mode === "many" ? date : "2026-10-02",
        openingMinor: opening.toString(),
        closingMinor: closing.toString(),
        completeness: {
          declaredComplete: false,
          basis: "Syntetiskt urval, inte komplett kontoutdrag",
        },
        rows,
      };

      const content = JSON.stringify(statement);

      if (content.length > 65536) throw new Error("Demo statement exceeds evidence limit");

      const evidence = await call("/evidence", {
        title: "Kontoutdrag september",
        content,
        mediaType: "application/json",
        origin: "Syntetiskt visningsunderlag",
      });

      const imported = await call("/bank-statements", {
        ...statement,
        evidenceId: evidence.id,
        existingMatches: [],
      });

      result.bankStatements.push(imported);
      opening = closing;
    }

    if (mode === "demo") {
      const bytes = await readFile(
        new URL("../testerarmy/bank-review-original.pdf", import.meta.url),
      );

      const source = await call("/source-occurrences", {
        sourceSystem: "synthetic-demo-bank",
        sourceAccountId: "originals",
        occurrenceKey: randomUUID(),
        sourceRevision: "1",
        filename: "DEMO-2026-0037.pdf",
        mediaType: "application/pdf",
        contentBase64: bytes.toString("base64"),
      });

      const evidence = await call("/evidence", {
        title: "Exempel Kontorsservice AB",
        origin: "Syntetisk bankrad. Ingen fastställd momsbehandling.",
        mediaType: "application/json",
        content: JSON.stringify({
          kind: "supplier_invoice_source_v1",
          source: { occurrenceId: source.id, sha256: source.sha256, filename: source.filename },
          fields: { supplierName: "Exempel Kontorsservice AB", documentNumber: "DEMO-2026-0037" },
        }),
      });

      const plan = await call("/change-sets", {
        kind: "manual_journal",
        evidenceId: evidence.id,
        eventKey: randomUUID(),
        accountingPeriodId: fixture.periods[0].id,
        postingDate: "2026-10-03",
        series: "A",
        description: "Exempel Kontorsservice AB, DEMO-2026-0037",
        rationale: "Syntetisk matchningskapacitet. Ingen fastställd momsbehandling.",
        taxAssessment: "not_applicable",
        lines: [
          {
            accountId: "account_bank",
            debitMinor: "0",
            creditMinor: "125000",
            description: "Utbetalning",
          },
          {
            accountId: "account_clearing",
            debitMinor: "125000",
            creditMinor: "0",
            description: "Syntetisk motrad",
          },
        ],
      });

      const exact = { version: plan.version, planDigest: plan.planDigest };
      const approval = await call(`/change-sets/${plan.id}/approvals`, exact);

      const receipt = await call(`/change-sets/${plan.id}/execute`, {
        ...exact,
        approvalId: approval.id,
      });

      const statement = {
        kind: "synthetic_bank_statement_v1",
        statementIdentifier: `demo_match_${randomUUID()}`,
        sourceBankAccountId: "demo_bank",
        accountId: "account_bank",
        currency: "SEK",
        startsOn: "2026-10-03",
        endsOn: "2026-10-03",
        openingMinor: opening.toString(),
        closingMinor: (opening - 125000n).toString(),
        completeness: {
          declaredComplete: false,
          basis: "Syntetiskt urval, inte komplett kontoutdrag",
        },
        rows: [
          {
            rowOrdinal: 1,
            providerId: null,
            date: "2026-10-03",
            description: "BG EXEMPEL KONTORSSERVICE",
            amountMinor: "-125000",
          },
        ],
      };

      const statementEvidence = await call("/evidence", {
        title: "Kontoutdrag 3 oktober",
        origin: "Syntetiskt visningsunderlag",
        mediaType: "application/json",
        content: JSON.stringify(statement),
      });

      const imported = await call("/bank-statements", {
        ...statement,
        evidenceId: statementEvidence.id,
        existingMatches: [],
      });

      result.bankStatements.push(imported);

      const candidates = await call("/bank-match-candidates", {
        statementId: imported.statement.id,
        rowOrdinal: 1,
      });

      if (
        candidates.candidates.length !== 1 ||
        candidates.candidates[0].voucherId !== receipt.voucherId
      )
        throw new Error("Demo bank row must have one real posted candidate");
      result.bankReview = { statementId: imported.statement.id, voucherId: receipt.voucherId };
      result.boards["K-21"] = {
        route: `${workspace}/accounts?account=account_bank&from=2026-10-03&to=2026-10-03&statement=${imported.statement.id}&row=1`,
        state: "one posted candidate, original available; identity unestablished",
        buttonClicks: ["Välj"],
      };
      result.boards["K-20"].route =
        `${workspace}/accounts?account=account_bank&from=2026-09-01&to=2026-10-03`;

      const saved = await operator(`${workspace}/saved-posting-requests`, {
        operation: "prepare_journal",
        input: {
          kind: "manual_journal",
          evidenceId: evidence.id,
          eventKey: randomUUID(),
          accountingPeriodId: fixture.periods[0].id,
          postingDate: "2026-10-02",
          series: "A",
          description: "Syntetisk sparad begäran",
          rationale: "Endast sparad, aldrig körd.",
          taxAssessment: "not_applicable",
          lines: [
            {
              accountId: "account_bank",
              debitMinor: "12500",
              creditMinor: "0",
              description: "Bank",
            },
            {
              accountId: "account_clearing",
              debitMinor: "0",
              creditMinor: "12500",
              description: "Motkonto",
            },
          ],
        },
      });

      if (saved.outcome !== null)
        throw new Error("Saved demo request must remain genuinely unknown");
      result.unknown = { key: saved.request.key, unattempted: true, outcome: null };
      result.boards["K-15"] = {
        route: `${workspace}/work?kind=journal&status=all`,
        state: "stored unknown preparation, never attempted",
        buttonClicks: ["Återställ en begäran", "Granska sparad begäran"],
        readyText: "Okänt utfall",
      };
    }

    result.bank = result.bankStatements[0];
    result.bankRowCount = result.bankStatements.reduce(
      (total, item) => total + item.statement.rows.length,
      0,
    );

    if (result.bankRowCount !== bankRows.length + (mode === "demo" ? 1 : 0))
      throw new Error("Retained bank rows differ from demo input");
    const view = await call(`/commerce/supplier-acceptance-reviews/${first.reviewId}`);

    if (
      view.plan.draftSnapshot.totals.grossMinor !== first.expectedGrossMinor ||
      view.acceptance !== null
    )
      throw new Error("Demo proposal readback differs or was posted");
    result.attention = await call("/attention?status=open&sort=oldest");
    result.ledger = await call("/ledger");
    await writeFile(join(artifacts, "demo-seed.json"), `${JSON.stringify(result, null, 2)}\n`);

    return result;
  } finally {
    await browser.close();
  }
}
