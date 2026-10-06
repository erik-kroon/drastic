import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
const sessionFile = resolve(process.argv[2] ?? "");
if (basename(sessionFile) !== "session.json" || !basename(dirname(sessionFile)).startsWith("openerp-paper-")) throw new Error("Use a private disposable Paper session");
const session = JSON.parse(await readFile(sessionFile, "utf8"));
const origin = new URL(session.apiUrl);
if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:") throw new Error("Only the disposable local Worker is allowed");
const base = `${origin.origin}/api/v1/entities/entity_synthetic/books/book_synthetic`;
async function call(path, input) {
  const response = await fetch(`${base}${path}`, { method: input ? "POST" : "GET", headers: { authorization: `Bearer ${session.accessToken}`, ...(input ? { "content-type": "application/json", "idempotency-key": randomUUID() } : {}) }, body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
// FIXTURE-ONLY SQL: chart accounts in the launcher's isolated scratch database. No financial writes.
const scratch = dirname(sessionFile);
const pid = (await readFile(join(scratch, "pgdata/postmaster.pid"), "utf8")).split("\n");
const password = (await readFile(join(scratch, "pg-password"), "utf8")).trim();
const { Client } = createRequire(join(import.meta.dirname, "../../apps/api/package.json"))("pg");
const admin = new Client({ connectionString: `postgresql://postgres:${password}@127.0.0.1:${Number(pid[3])}/postgres` });
await admin.connect();
try {
  for (const [id, code, name] of [["account_consulting", "6550", "Konsultarvoden"], ["account_input_vat", "2641", "Ingående moms"], ["account_supplier", "2440", "Leverantörsskuld"], ["account_rent", "5010", "Lokalhyra"], ["account_telephone", "6212", "Telefon"], ["account_electricity", "5020", "El för belysning"]]) await admin.query("INSERT INTO openerp.accounts(book_id,id,code,name) VALUES ('book_synthetic',$1,$2,$3) ON CONFLICT DO NOTHING", [id, code, name]);
} finally { await admin.end(); }
const fixture = [
  { name: "Telia Sverige AB", title: "Telia Sverige AB, kvitto 5512", gross: "51920", date: "2026-09-30", account: "account_telephone" },
  { name: "Elkraft Norr AB", title: "Elkraft Norr AB, elräkning", gross: "318000", date: "2026-10-02", account: "account_electricity" },
  { name: "Fjällfastigheter AB", title: "Fjällfastigheter AB, hyra november", gross: "2400000", date: "2026-10-01", account: "account_rent", number: "HYRA-2026-11", due: "2026-10-31" },
  { name: "Nordhamn Studio AB", title: "Nordhamn Studio AB, faktura 1048", gross: "1250000", date: "2026-10-03", account: "account_consulting", number: "1048", due: "2026-10-02" },
  { name: "Vinter & Co AB", title: "Vinter & Co AB, faktura 882", gross: "249000", date: "2026-10-03", account: "account_consulting", number: "882", due: "2026-10-14" },
];
const receipts = [];
await mkdir("test-results/paper", { recursive: true });
const existingPage = await call("/vouchers?after=0");
if (existingPage.next) throw new Error("Load all voucher pages before resuming this fixture");
const partyPage = await call("/commerce/counterparties");
if (partyPage.next) throw new Error("Load all party pages before resuming this fixture");
const invoicePage = await call("/commerce/invoices");
if (invoicePage.next) throw new Error("Load all invoice pages before resuming this fixture");
for (const example of fixture) {
  let voucher = existingPage.items.find((item) => item.action.description === example.title);
  if (!voucher) {
    const evidence = await call("/evidence", { title: example.title, content: `Synthetic mixed-register fixture: ${example.title}, grossMinor ${example.gross}. Not a real company source.`, mediaType: "text/plain", origin: "Disposable Paper verification" });
    const tax = BigInt(example.gross) / 5n;
    const plan = await call("/change-sets", { kind: "manual_journal", evidenceId: evidence.id, eventKey: `paper_mixed_${randomUUID()}`, accountingPeriodId: "period_synthetic_2026", postingDate: example.date, series: "A", description: example.title, rationale: "Disposable synthetic mixed-register fixture", taxAssessment: "not_applicable", lines: [{ accountId: example.account, debitMinor: String(BigInt(example.gross) - tax), creditMinor: "0", description: example.title }, { accountId: "account_input_vat", debitMinor: String(tax), creditMinor: "0", description: example.title }, { accountId: "account_supplier", debitMinor: "0", creditMinor: example.gross, description: example.title }] });
    const input = { planDigest: plan.planDigest, version: plan.version };
    const approval = await call(`/change-sets/${plan.id}/approvals`, input);
    const execution = await call(`/change-sets/${plan.id}/execute`, { ...input, approvalId: approval.id });
    voucher = await call(`/vouchers/${execution.voucherId}`);
  }
  const evidence = voucher.action.evidenceRefs[0];
  const line = voucher.action.lines.find((item) => item.accountId === "account_supplier");
  if (!evidence || !line || line.creditMinor !== example.gross || voucher.action.description !== example.title) throw new Error("Retained mixed-register source mismatch");
  const receipt = { description: example.title, grossMinor: example.gross, voucherId: voucher.id, invoiceId: null };
  receipts.push(receipt);
  await writeFile("test-results/paper/mixed-register-seed.json", JSON.stringify({ synthetic: true, complete: false, payments: false, receipts }, null, 2));
  if (example.number) {
    let party = partyPage.items.find((item) => item.displayName === example.name && item.role === "supplier");
    if (!party) party = await call("/commerce/counterparties", { kind: "synthetic_counterparty_v1", externalKey: `paper_mixed_${randomUUID()}`, role: "supplier", displayName: example.name, evidenceId: evidence.evidenceId, reason: "Disposable synthetic fixture" });
    let invoice = invoicePage.items.find((item) => item.counterpartyId === party.id && item.documentNumber === example.number && item.recognition?.voucherId === voucher.id);
    if (!invoice) invoice = await call("/commerce/invoices", { kind: "synthetic_invoice_v1", direction: "supplier", counterpartyId: party.id, counterpartyRevision: party.revision, documentNumber: example.number, issuedOn: example.name === "Nordhamn Studio AB" ? "2026-09-02" : example.date, dueOn: example.due, currency: voucher.action.currency, amountMinor: line.creditMinor, controlAccountId: line.accountId, recognitionVoucherId: voucher.id, recognitionLineId: line.lineId, evidenceId: evidence.evidenceId, description: example.title });
    receipt.invoiceId = invoice.id;
  }
}
await mkdir("test-results/paper", { recursive: true });
await writeFile("test-results/paper/mixed-register-seed.json", JSON.stringify({ synthetic: true, complete: true, payments: false, receipts }, null, 2));
console.log(JSON.stringify({ posted: receipts.length, registeredSuppliers: receipts.filter((item) => item.invoiceId).length, artifact: "test-results/paper/mixed-register-seed.json" }));
