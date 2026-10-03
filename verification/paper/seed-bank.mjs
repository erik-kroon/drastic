import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const sessionFile = resolve(process.argv[2] ?? "");

if (
  basename(sessionFile) !== "session.json" ||
  !basename(dirname(sessionFile)).startsWith("openerp-paper-")
)
  throw new Error("Use the private session file produced by the Paper launcher");

const session = JSON.parse(await readFile(sessionFile, "utf8"));

const origin = new URL(session.apiUrl);

if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:")
  throw new Error("Only the disposable local Worker is allowed");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function request(path, input) {
  const headers = { authorization: `Bearer ${session.accessToken}` };

  if (input) {
    headers["content-type"] = "application/json";
    headers["idempotency-key"] = randomUUID();
  }

  const response = await fetch(`${origin.origin}${scope}${path}`, {
    method: input ? "POST" : "GET",
    headers,
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const result = await response.json();

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const initial = JSON.parse(
  await readFile(join(import.meta.dirname, "../../test-results/paper/seed.json"), "utf8"),
);

const recovery = await request(`/posting-recovery/${encodeURIComponent(initial.journalId)}`);

const receipt = recovery.summary.executionReceipt;

if (!receipt)
  throw new Error(
    "Post the initial synthetic journal through the product before seeding bank activity",
  );

const voucher = await request(`/vouchers/${encodeURIComponent(receipt.voucherId)}`);

const line = voucher.action.lines.find(
  (item) => item.accountId === "account_bank" && item.debitMinor === "185000",
);

if (!line) throw new Error("The synthetic voucher has no retained bank debit");

const source = {
  kind: "synthetic_bank_statement_v1",
  statementIdentifier: `paper_bank_${randomUUID()}`,
  sourceBankAccountId: "paper_synthetic_1930",
  accountId: line.accountId,
  currency: "SEK",
  startsOn: "2026-10-01",
  endsOn: "2026-10-03",
  openingMinor: "0",
  closingMinor: "100000",
  completeness: {
    declaredComplete: true,
    basis: "Disposable synthetic statement, not a bank result",
  },
  rows: [
    {
      rowOrdinal: 1,
      providerId: null,
      date: "2026-10-03",
      description: "Synthetic retained transfer",
      amountMinor: "185000",
    },
    {
      rowOrdinal: 2,
      providerId: null,
      date: "2026-10-03",
      description: "Synthetic unmatched outflow",
      amountMinor: "-85000",
    },
  ],
};

const evidence = await request("/evidence", {
  title: "Disposable synthetic statement",
  content: JSON.stringify(source),
  mediaType: "application/json",
  origin: "Paper local UI verification",
});

const imported = await request("/bank-statements", {
  ...source,
  evidenceId: evidence.id,
  existingMatches: [{ rowOrdinal: 1, voucherId: voucher.id, lineId: line.lineId }],
});

const artifact = join(import.meta.dirname, "../../test-results/paper/bank-seed.json");

await writeFile(
  artifact,
  JSON.stringify(
    {
      synthetic: true,
      statementId: imported.statement.id,
      accountId: line.accountId,
      voucherId: voucher.id,
      retainedMatchOrdinal: 1,
      unmatchedOrdinal: 2,
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ seeded: true, artifact }));
