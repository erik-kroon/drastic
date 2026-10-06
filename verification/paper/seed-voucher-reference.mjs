import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
const sessionFile = resolve(process.argv[2] ?? "");
if (
  basename(sessionFile) !== "session.json" ||
  !basename(dirname(sessionFile)).startsWith("openerp-paper-")
)
  throw new Error("Use the private disposable session");
const session = JSON.parse(await readFile(sessionFile, "utf8"));
const api = new URL(session.apiUrl);
if (api.hostname !== "127.0.0.1" || api.protocol !== "http:")
  throw new Error("Only the disposable local Worker is allowed");
const scope = { entityId: "entity_paper_vouchers", bookId: "book_paper_vouchers" };
const fixtureDirectory = join(dirname(sessionFile), "openerp-paper-vouchers");
await mkdir(fixtureDirectory, { recursive: true, mode: 0o700 });
const privateFile = join(fixtureDirectory, "session.json");
let fixtureSession;
try {
  fixtureSession = JSON.parse(await readFile(privateFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  fixtureSession = {
    ...session,
    accessToken: randomBytes(32).toString("hex"),
    workspace: `${session.url}/entities/${scope.entityId}/books/${scope.bookId}`,
  };
  await writeFile(privateFile, JSON.stringify(fixtureSession), { mode: 0o600 });
}
const pid = (await readFile(join(dirname(sessionFile), "pgdata/postmaster.pid"), "utf8")).split(
  "\n",
);
const password = (await readFile(join(dirname(sessionFile), "pg-password"), "utf8")).trim();
const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${Number(pid[3])}/postgres`;
const { Client } = createRequire(join(import.meta.dirname, "../../apps/api/package.json"))("pg");
const admin = new Client({ connectionString: adminUrl });
await admin.connect();
const accounts = [
  { id: "account_bank", code: "1930", name: "Bank" },
  { id: "account_clearing", code: "2999", name: "Avräkning" },
  { id: "account_consulting", code: "6550", name: "Konsultarvoden" },
  { id: "account_input_vat", code: "2641", name: "Ingående moms" },
  { id: "account_supplier", code: "2440", name: "Leverantörsskuld" },
  { id: "account_rent", code: "5010", name: "Lokalhyra" },
  { id: "account_telephone", code: "6212", name: "Telefon" },
  { id: "account_electricity", code: "5020", name: "El för belysning" },
];
try {
  const existing = await admin.query("SELECT id FROM openerp.books WHERE id=$1", [scope.bookId]);
  if (!existing.rowCount) {
    const config = {
      entity: { id: scope.entityId, name: "Disposable Paper voucher reference" },
      book: {
        id: scope.bookId,
        name: "Fjällby Konsult AB",
        currency: "SEK",
        profile: "synthetic-core-v1",
      },
      actor: {
        id: "actor_paper_vouchers",
        name: "Elin Sund",
        role: "operator",
        tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      fiscalYear: { id: "year_paper_vouchers", startsOn: "2026-01-01", endsOn: "2026-12-31" },
      periods: [{ id: "period_paper_vouchers", startsOn: "2026-01-01", endsOn: "2026-12-31" }],
      accounts,
    };
    const manifest = join(fixtureDirectory, "book.json");
    await writeFile(manifest, JSON.stringify(config));
    await promisify(execFile)("bun", ["scripts/provision.ts", manifest], {
      cwd: resolve(import.meta.dirname, "../../apps/api"),
      env: {
        ...process.env,
        DATABASE_ADMIN_URL: adminUrl,
        OPENERP_ACCESS_TOKEN: fixtureSession.accessToken,
      },
    });
  }
  // FIXTURE-ONLY identity admission: allow this runtime's browser operator to inspect the reference book.
  await admin.query(
    "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES ($1,'actor_operator','operator') ON CONFLICT DO NOTHING",
    [scope.bookId],
  );
} finally {
  await admin.end();
}
const login = await fetch(`${session.url}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: session.url },
  body: JSON.stringify({ email: session.email, password: session.password }),
  signal: AbortSignal.timeout(15000),
});
if (!login.ok) throw new Error(`Synthetic operator sign-in failed: ${login.status}`);
const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
if (!cookie) throw new Error("Synthetic operator session missing");
const base = `${session.url}/api/v1/entities/${scope.entityId}/books/${scope.bookId}`;
async function call(path, input) {
  const response = await fetch(`${base}${path}`, {
    method: input ? "POST" : "GET",
    headers: {
      cookie,
      origin: session.url,
      ...(input ? { "content-type": "application/json", "idempotency-key": randomUUID() } : {}),
    },
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
const examples = [
  ["Syntetisk överföring", "1620000", "2026-09-12", "account_bank"],
  ["Telia Sverige AB, kvitto 5512", "51920", "2026-09-30", "account_telephone"],
  ["Fjällfastigheter AB, hyra november", "2400000", "2026-10-01", "account_rent"],
  ["Elkraft Norr AB, elräkning", "318000", "2026-10-02", "account_electricity"],
  ["Nordhamn Studio AB, faktura 1048", "1250000", "2026-10-03", "account_consulting"],
  ["Vinter & Co AB, faktura 882", "249000", "2026-10-03", "account_consulting"],
];
const current = await call("/vouchers?after=0");
if (current.next) throw new Error("Unexpected voucher pagination in this six-posting fixture");
const receipts = [];
for (const [description, gross, date, account] of examples) {
  let voucher = current.items.find((item) => item.action.description === description);
  if (!voucher) {
    const evidence = await call("/evidence", {
      title: description,
      content: `Disposable synthetic reference: ${description}, grossMinor ${gross}.`,
      mediaType: "text/plain",
      origin: "Paper verification fixture",
    });
    const tax = account === "account_bank" ? 0n : BigInt(gross) / 5n;
    const lines = [
      {
        accountId: account,
        debitMinor: String(BigInt(gross) - tax),
        creditMinor: "0",
        description,
      },
      ...(tax
        ? [
            {
              accountId: "account_input_vat",
              debitMinor: String(tax),
              creditMinor: "0",
              description,
            },
          ]
        : []),
      {
        accountId: account === "account_bank" ? "account_clearing" : "account_supplier",
        debitMinor: "0",
        creditMinor: gross,
        description,
      },
    ];
    const plan = await call("/change-sets", {
      kind: "manual_journal",
      evidenceId: evidence.id,
      eventKey: `paper_voucher_${randomUUID()}`,
      accountingPeriodId: "period_paper_vouchers",
      postingDate: date,
      series: "A",
      description,
      rationale: "Disposable synthetic reference posting",
      taxAssessment: "not_applicable",
      lines,
    });
    const input = { planDigest: plan.planDigest, version: plan.version };
    const approval = await call(`/change-sets/${plan.id}/approvals`, input);
    const execution = await call(`/change-sets/${plan.id}/execute`, {
      ...input,
      approvalId: approval.id,
    });
    voucher = await call(`/vouchers/${execution.voucherId}`);
  }
  const debit = voucher.action.lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n);
  if (debit !== BigInt(gross)) throw new Error("Retained voucher amount mismatch");
  receipts.push({
    id: voucher.id,
    number: `${voucher.action.series}${voucher.number}`,
    description,
    grossMinor: gross,
  });
  await writeFile(
    "test-results/paper/voucher-reference-seed.json",
    JSON.stringify(
      { synthetic: true, scope, complete: receipts.length === examples.length, receipts },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({
    scope,
    vouchers: receipts.length,
    artifact: "test-results/paper/voucher-reference-seed.json",
  }),
);
