import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { content, invoiceInventory, assetInventory } from "./onboarding-history-fixture.mjs";

const file = process.argv[2];

if (
  !file ||
  basename(file) !== "session.json" ||
  !basename(dirname(file)).startsWith("openerp-paper-")
)
  throw new Error("Use a private disposable session.");

const scratch = dirname(file),
  session = JSON.parse(await readFile(file, "utf8")),
  fixture = JSON.parse(await readFile(join(scratch, "onboarding-owner-fixture.json"), "utf8"));

const origin = new URL(session.apiUrl);

if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only isolated local owners are allowed.");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function request(path, input, token = session.accessToken) {
  const response = await fetch(origin.origin + scope + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(30000),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const before = await request("/onboarding/lifecycle");

if (
  before.activation ||
  before.projection.counts.importedVouchers !== 428 ||
  fixture.preview.sourceSha256 !== `sha256:${createHash("sha256").update(content).digest("hex")}`
)
  throw new Error("Use the untouched full financial 428-voucher fixture.");

const sourceRows = Array.from(content.matchAll(/#VER A (\d+) (\d{8}) "([^"]*)"/g), (match) => ({
  reference: `A:${match[1]}`,
  date: `${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6)}`,
  title: match[3],
}));

const vouchers = [];

let cursor = "";

do {
  const page = await request("/vouchers" + (cursor ? `?after=${cursor}` : ""));
  vouchers.push(...page.items);
  cursor = page.next;
} while (cursor);

function voucherFor(title) {
  const row = sourceRows.find((item) => item.title === title),
    voucher = row && vouchers.find((item) => item.action.description === `SIE ${row.reference}`);

  if (!voucher) throw new Error(`Missing retained posting: ${title}`);

  return { row, voucher };
}

const receipts = [];

for (const inventory of invoiceInventory) {
  for (const [identity, amount, name, paid] of inventory.items) {
    const source = sourceRows.find((item) =>
      item.title.startsWith(`Faktura ${identity}, ${name}, förfallodag `),
    );

    if (!source) throw new Error("Missing retained invoice metadata.");

    const { voucher } = voucherFor(source.title),
      accountId = inventory.direction === "customer" ? "account_ar" : "account_ap";

    const line = voucher.action.lines.find((item) => item.accountId === accountId);
    const evidenceId = voucher.action.evidenceRefs[0]?.evidenceId;
    const magnitude = BigInt(line.debitMinor) - BigInt(line.creditMinor);

    if (magnitude !== amount)
      throw new Error("Independent invoice inventory differs from its posting.");

    const existing = before.projection.invoices.find(
      (item) => item.documentNumber === identity && item.direction === inventory.direction,
    );

    const party = existing
      ? null
      : await request("/commerce/counterparties", {
          kind: "synthetic_counterparty_v1",
          externalKey: `onboarding_${inventory.direction}_${identity}`,
          role: inventory.direction,
          displayName: name,
          evidenceId,
          reason: "Retained synthetic invoice handoff",
        });

    const invoice =
      existing ??
      (await request("/commerce/invoices", {
        kind: "synthetic_invoice_v1",
        direction: inventory.direction,
        counterpartyId: party.id,
        counterpartyRevision: party.revision,
        documentNumber: identity,
        issuedOn: voucher.action.postingDate,
        dueOn: source.title.slice(-10),
        currency: voucher.action.currency,
        amountMinor: (magnitude < 0n ? -magnitude : magnitude).toString(),
        controlAccountId: accountId,
        recognitionVoucherId: voucher.id,
        recognitionLineId: line.lineId,
        evidenceId,
        description: source.title,
      }));

    let allocation = null;

    if (paid && invoice.outstandingMinor !== "0") {
      const payment = voucherFor(`Betalning ${identity}`).voucher,
        paymentLine = payment.action.lines.find((item) => item.accountId === accountId);

      const plan = await request("/commerce/allocation-plans", {
        voucherId: payment.id,
        lineId: paymentLine.lineId,
        evidenceId: payment.action.evidenceRefs[0].evidenceId,
        rationale: "Allocate the actual retained historical settlement",
        allocations: [{ invoiceId: invoice.id, amountMinor: invoice.amountMinor }],
      });

      const approval = await request(
        `/commerce/allocation-plans/${plan.id}/approvals`,
        { version: plan.version, planDigest: plan.digest },
        fixture.reviewerToken,
      );

      allocation = await request(`/commerce/allocation-plans/${plan.id}/apply`, {
        version: plan.version,
        planDigest: plan.digest,
        approvalId: approval.id,
      });
    }

    receipts.push({ sourceIdentity: identity, invoiceId: invoice.id, allocation });

    if (receipts.length % 10 === 0) console.info(JSON.stringify({ invoices: receipts.length }));
  }
}

const control = before.controls.find(
  (item) => item.kind === "historical_asset_register" && item.asOf === "2026-09-30",
);

const registerContent =
  "as_of,currency,source_identity,account_code,cost_minor,accumulated_depreciation_minor\n" +
  assetInventory
    .map((item) => `2026-09-30,SEK,${item.identity},1210,${item.cost},${item.accumulated}\n`)
    .join("");

if (control.sourceSha256 !== `sha256:${createHash("sha256").update(registerContent).digest("hex")}`)
  throw new Error("Retained asset register differs.");

const review = await request("/evidence", {
    title: "Retained synthetic asset register review",
    mediaType: "text/plain",
    content: registerContent,
    origin: "Independent synthetic register",
  }),
  assets = [];

for (const item of control.assetRegister.rows) {
  const { voucher } = voucherFor(`Ingående tillgång ${item.sourceIdentity}`),
    evidenceId = voucher.action.evidenceRefs[0].evidenceId;

  const schedule = await request("/schedules", {
    sourceKey: `onboarding_${item.sourceIdentity}`,
    terms: {
      kind: "asset",
      name: `Tillgång ${item.sourceIdentity}`,
      evidenceId,
      rationale: "Remaining depreciation of the retained imported opening",
      costMinor: item.carryingMinor,
      residualMinor: "0",
      usefulPeriods: 1,
      allocationPolicy: "equal_minor_final_remainder_v1",
      debitAccountId: "account_expense",
      creditAccountId: item.accountId,
      series: "A",
      periods: [{ postingDate: "2026-10-31", accountingPeriodId: "period_synthetic_2026" }],
      taxAssessment: "not_applicable",
    },
  });

  const basis = await request("/subledger-controls/bases", {
    scheduleId: schedule.scheduleId,
    expectedDigest: schedule.digest,
    kind: "imported_opening",
    effectiveOn: voucher.action.postingDate,
    evidenceId,
    sourceLocator: `onboarding_asset:${control.sourceSha256}:${item.sourceIdentity}`,
    reviewEvidenceId: review.id,
    rationale: "Independent retained cost and accumulated depreciation",
    originalCostMinor: item.costMinor,
    accumulatedMinor: item.accumulatedDepreciationMinor,
    carryingMinor: item.carryingMinor,
    voucherId: voucher.id,
    lineIds: voucher.action.lines
      .filter((line) => line.accountId === item.accountId)
      .map((line) => line.lineId),
  });

  assets.push(basis);
}

const after = await request("/onboarding/lifecycle");

if (
  after.projection.counts.customerInvoices !== 34 ||
  after.projection.counts.supplierInvoices !== 83 ||
  after.projection.counts.assets !== 4
)
  throw new Error("Native handoff totals did not reconcile.");

await writeFile(
  join(scratch, "onboarding-inventory-handoff.json"),
  JSON.stringify(
    { synthetic: true, counts: after.projection.counts, invoices: receipts, assets },
    null,
    2,
  ),
  { mode: 0o600 },
);

console.info(JSON.stringify({ synthetic: true, counts: after.projection.counts }));
