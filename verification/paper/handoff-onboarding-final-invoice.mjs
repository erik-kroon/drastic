import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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

if (before.activation || before.projection.counts.importedVouchers !== 434)
  throw new Error("Only the completed final historical source.");

const invoice = before.projection.invoices.find(
  (item) => item.direction === "customer" && item.documentNumber === "F-2026-0034",
);

if (!invoice || invoice.outstandingMinor !== "1250000")
  throw new Error("Retained unpaid F0034 required.");

const execution = JSON.parse(
  await readFile(join(scratch, "onboarding-delta-execution.json"), "utf8"),
);

const effect = execution.effects.find((item) => item.sourceReference === "A:430");

console.info(JSON.stringify({ effectKeys: Object.keys(effect) }));

let vouchers = [],
  cursor = "";

do {
  const page = await request("/vouchers" + (cursor ? `?after=${cursor}` : ""));
  vouchers.push(...page.items);
  cursor = page.next;
} while (cursor);

const payment = vouchers.find(
  (item) => item.action.description === "SIE A:430" && item.action.postingPurpose !== "reversal",
);

if (!payment) throw new Error("Actual final settlement posting missing.");

const line = payment.action.lines.find(
  (item) => item.accountId === "account_ar" && item.creditMinor === "1250000",
);

const plan = await request("/commerce/allocation-plans", {
  voucherId: payment.id,
  lineId: line.lineId,
  evidenceId: payment.action.evidenceRefs[0].evidenceId,
  rationale: "Retained F0034 settled on 30 September before native authority",
  allocations: [{ invoiceId: invoice.id, amountMinor: invoice.outstandingMinor }],
});

const approval = await request(
  `/commerce/allocation-plans/${plan.id}/approvals`,
  { version: plan.version, planDigest: plan.digest },
  fixture.reviewerToken,
);

const allocation = await request(`/commerce/allocation-plans/${plan.id}/apply`, {
  version: plan.version,
  planDigest: plan.digest,
  approvalId: approval.id,
});

await writeFile(
  join(scratch, "onboarding-final-invoice-handoff.json"),
  JSON.stringify({ synthetic: true, invoiceId: invoice.id, allocation }, null, 2),
  { mode: 0o600 },
);

console.info(JSON.stringify({ synthetic: true, F0034settledBeforeNativeAuthority: true }));
