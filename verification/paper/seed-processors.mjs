import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { assetClients } from "./asset-fixture-clients.mjs";

export const processorAccounts = [
  { id: "processor_control", code: "1580", name: "Fordran på betalförmedlaren" },
  { id: "processor_transit", code: "1581", name: "Utbetalning på väg från förmedlaren" },
  { id: "processor_dispute", code: "1582", name: "Tvistig fordran" },
  { id: "processor_fee", code: "6570", name: "Förmedlaravgifter" },
  { id: "processor_loss", code: "6350", name: "Förlust vid tvist" },
  { id: "processor_ar", code: "1510", name: "Kundfordringar" },
  { id: "processor_revenue", code: "3010", name: "Försäljning" },
  { id: "processor_gain", code: "3960", name: "Valutakursvinster" },
  { id: "processor_fx_loss", code: "7960", name: "Valutakursförluster" },
];

export async function seedProcessors(config) {
  const { book, author, reviewer, post } = await assetClients(config);
  const feed = config.processorFixture;
  if (new URL(feed.url).hostname !== "127.0.0.1") throw new Error("Processor fixture must be loopback");
  const { Client } = createRequire(join(import.meta.dirname, "../../apps/api/package.json"))("pg");
  const admin = new Client({ connectionString: config.adminUrl });
  await admin.connect();
  try {
    await admin.query("insert into openerp.bank_sources(book_id,account_id,source_bank_account_id) values ($1,'account_bank','synthetic_processor_bank')", [config.fixture.book.id]);
  } finally { await admin.end(); }
  const period = config.fixture.periods[0].id;
  const source = await post(book, "/evidence", {
    title: "Synthetic processor sources", mediaType: "text/plain",
    content: "Synthetic customer1250 fee30 payout1220, no company or live provider.", origin: "O25 synthetic source",
  });
  const recognition = await post(book, "/change-sets", {
    kind: "manual_journal", evidenceId: source.id, eventKey: randomUUID(), accountingPeriodId: period,
    postingDate: "2026-10-01", series: "A", description: "Synthetic customer recognition",
    rationale: "Synthetic processor customer", taxAssessment: "not_applicable",
    lines: [
      { accountId: "processor_ar", debitMinor: "125000", creditMinor: "0", description: "Synthetic customer" },
      { accountId: "processor_revenue", debitMinor: "0", creditMinor: "125000", description: "Synthetic recognition" },
    ],
  });
  const approved = await post(reviewer, `/change-sets/${recognition.id}/approvals`, { planDigest: recognition.planDigest, version: recognition.version });
  const recognized = await post(book, `/change-sets/${recognition.id}/execute`, { planDigest: recognition.planDigest, version: recognition.version, approvalId: approved.id });
  const get = async (path) => {
    const response = await fetch(`${config.apiUrl}/api/v1/entities/${config.fixture.entity.id}/books/${config.fixture.book.id}${path}`, { headers: { authorization: `Bearer ${book.token}` }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Processor fixture read refused ${response.status}`);
    return response.json();
  };
  const voucher = await get(`/vouchers/${recognized.voucherId}`);
  const line = voucher.action.lines.find((item) => item.accountId === "processor_ar");
  if (!line?.lineId) throw new Error("Processor fixture recognition line missing");
  const party = await post(book, "/commerce/counterparties", { kind: "synthetic_counterparty_v1", externalKey: "processor_customer", role: "customer", displayName: "Synthetic processor customer", evidenceId: source.id, reason: "O25 synthetic customer" });
  const invoice = await post(book, "/commerce/invoices", {
    kind: "synthetic_invoice_v1", direction: "customer", counterpartyId: party.id, counterpartyRevision: party.revision,
    documentNumber: "F-2026-0049", issuedOn: "2026-10-01", dueOn: "2026-10-31", currency: "SEK", amountMinor: "125000",
    controlAccountId: "processor_ar", recognitionVoucherId: voucher.id, recognitionLineId: line.lineId,
    evidenceId: source.id, description: "Synthetic retained processor obligation",
  });
  const account = await post(book, "/banking/processors/accounts", {
    profile: "synthetic_stripe_balance_v1", providerAccountId: "paper_processor", liveMode: false,
    currency: "SEK", currencyScale: 2, openedOn: "2026-10-01",
    processorControlAccountId: "processor_control", payoutTransitAccountId: "processor_transit", feeCostAccountId: "processor_fee",
    disputeReceivableAccountId: "processor_dispute", disputeLossAccountId: "processor_loss", bankAccountId: "account_bank",
    gainAccountId: "processor_gain", lossAccountId: "processor_fx_loss", evidenceId: source.id,
    acknowledgeLimitedProfile: true, acknowledgeGrossFeesWithoutInputVat: true,
  });
  const charge = { id: "paper_charge", sourceId: "paper_charge_source", type: "charge", currency: "SEK", currencyScale: 2,
    grossMinor: "125000", feeMinor: "3000", netMinor: "122000", occurredOn: "2026-10-01", availableOn: "2026-10-01",
    providerPayoutId: null, disputeId: null, payoutMethod: null, destinationBankAccountId: null };
  const payout = { ...charge, id: "paper_payout", sourceId: "po_paper", type: "payout", grossMinor: "-122000", feeMinor: "0", netMinor: "-122000",
    occurredOn: "2026-10-02", availableOn: "2026-10-02", providerPayoutId: "po_paper", payoutMethod: "automatic", destinationBankAccountId: "synthetic_processor_bank" };
  const seeded = await fetch(`${feed.url}/fixtures/${account.providerAccountId}`, {
    method: "PUT", headers: { authorization: `Bearer ${feed.secret}`, "content-type": "application/json" },
    body: JSON.stringify({ profile: account.profile, accountId: account.providerAccountId, liveMode: false, currency: "SEK", currencyScale: 2,
      startsOn: "2026-10-01", endsOn: "2026-10-03", openingMinor: "0", closingMinor: "0", complete: true, rows: [charge, payout] }),
  });
  if (!seeded.ok) throw new Error("Synthetic processor seed refused");
  const fetched = await post(book, `/banking/processors/accounts/${account.id}/fetches`, { startsOn: "2026-10-01", endsOn: "2026-10-03", view: "balance" });
  await post(book, `/banking/processors/accounts/${account.id}/fetches`, { startsOn: "2026-10-01", endsOn: "2026-10-03", view: "automatic_payout", providerPayoutId: "po_paper" });
  const shared = { accountId: account.id, accountingPeriodId: period, series: "A", evidenceId: source.id, reason: "O25 synthetic processor", acknowledgeLimitedProfile: true };
  for (const observation of fetched.observations) {
    const review = await post(book, "/banking/processors/reviews", { ...shared, kind: "observation", date: observation.occurredOn, observationId: observation.id, ...(observation.type === "charge" ? { invoiceId: invoice.id } : {}) });
    const approval = await post(reviewer, `/banking/processors/reviews/${review.id}/approvals`, { version: 1, digest: review.digest });
    await post(book, `/banking/processors/reviews/${review.id}/execute`, { version: 1, digest: review.digest, approvalId: approval.id });
  }
  const original = { kind: "synthetic_bank_statement_v1", statementIdentifier: "O25-statement", sourceBankAccountId: "synthetic_processor_bank", accountId: "account_bank",
    currency: "SEK", startsOn: "2026-10-01", endsOn: "2026-10-03", openingMinor: "0", closingMinor: "122000",
    completeness: { declaredComplete: true, basis: "Synthetic complete payout receipt" },
    rows: [{ rowOrdinal: 1, providerId: "po_paper", date: "2026-10-03", description: "Utbetalning från förmedlaren", amountMinor: "122000" }] };
  const evidence = await post(book, "/evidence", { title: "Synthetic payout statement", mediaType: "application/json", content: JSON.stringify(original), origin: "O25 synthetic bank receipt" });
  const imported = await post(book, "/bank-statements", { ...original, evidenceId: evidence.id, existingMatches: [] });
  const payoutObservation = fetched.observations.find((item) => item.type === "payout");
  const review = await post(reviewer, "/banking/processors/reviews", { ...shared, kind: "bank_receipt", date: "2026-10-03", payoutObservationId: payoutObservation.id,
    bankObservation: { statementId: imported.statement.id, rowOrdinal: 1 } });
  const fixture = { synthetic: true, accountId: account.id, reviewId: review.id, entityId: config.fixture.entity.id, bookId: config.fixture.book.id };
  await writeFile(join(config.artifacts, "processor-fixture.json"), JSON.stringify(fixture, null, 2));
  return fixture;
}
