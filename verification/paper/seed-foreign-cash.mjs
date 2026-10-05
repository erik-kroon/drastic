import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { assetClients } from "./asset-fixture-clients.mjs";

export const foreignCashAccounts = [
  { id: "cash_eur", code: "1941", name: "Valutakonto EUR" },
  { id: "cash_fee", code: "6570", name: "Bankkostnader" },
  { id: "cash_gain", code: "3960", name: "Valutakursvinster" },
  { id: "cash_loss", code: "7960", name: "Valutakursförluster" },
];

export async function seedForeignCash(config) {
  const { book, author, reviewer, post } = await assetClients(config);
  const { Client } = createRequire(join(import.meta.dirname, "../../apps/api/package.json"))("pg");
  const admin = new Client({ connectionString: config.adminUrl });

  await admin.connect();
  try {
    await admin.query(
      "insert into openerp.bank_sources(book_id,account_id,source_bank_account_id) values ($1,'cash_eur','synthetic_eur'),($1,'account_bank','synthetic_sek')",
      [config.fixture.book.id],
    );
  } finally {
    await admin.end();
  }
  const period = config.fixture.periods[0].id;
  const evidence = await post(book, "/evidence", {
    title: "Synthetic foreign cash opening",
    content: "Synthetic EUR6000 with SEK66000 retained carrying. No company data.",
    mediaType: "text/plain",
    origin: "O24 synthetic source",
  });
  const opening = await post(book, "/change-sets", {
    kind: "manual_journal",
    evidenceId: evidence.id,
    eventKey: randomUUID(),
    accountingPeriodId: period,
    postingDate: "2026-10-01",
    series: "A",
    description: "Synthetic EUR opening carrying",
    rationale: "Synthetic foreign cash opening",
    taxAssessment: "not_applicable",
    lines: [
      {
        accountId: "cash_eur",
        debitMinor: "6600000",
        creditMinor: "0",
        description: "Synthetic opening",
      },
      {
        accountId: "account_clearing",
        debitMinor: "0",
        creditMinor: "6600000",
        description: "Synthetic opening",
      },
    ],
  });
  const openingApproval = await post(author, `/change-sets/${opening.id}/approvals`, {
    planDigest: opening.planDigest,
    version: opening.version,
  });
  await post(author, `/change-sets/${opening.id}/execute`, {
    planDigest: opening.planDigest,
    version: opening.version,
    approvalId: openingApproval.id,
  });

  const shared = {
    accountId: "cash_eur",
    date: "2026-10-01",
    accountingPeriodId: period,
    series: "A",
    evidenceId: evidence.id,
    sourceIdentity: randomUUID(),
    reason: "Synthetic foreign cash",
    acknowledgeLimitedProfile: true,
  };
  const retainedOpening = await post(book, "/banking/foreign-cash/reviews", {
    ...shared,
    kind: "open",
    nativeCurrency: "EUR",
    nativeScale: 2,
    openingNativeMinor: "600000",
  });
  const approvedOpening = await post(
    reviewer,
    `/banking/foreign-cash/reviews/${retainedOpening.id}/approvals`,
    { version: 1, digest: retainedOpening.digest },
  );
  await post(author, `/banking/foreign-cash/reviews/${retainedOpening.id}/execute`, {
    version: 1,
    digest: retainedOpening.digest,
    approvalId: approvedOpening.id,
  });

  const nativeObservation = await statement(
    "cash_eur",
    "EUR",
    "600000",
    "-200000",
    "EUR-konto 3 okt.json",
  );
  const bookObservation = await statement(
    "account_bank",
    "SEK",
    "0",
    "2260000",
    "SEK-konto 3 okt.json",
  );

  async function statement(accountId, currency, openingMinor, amountMinor, title) {
    const source = {
      kind: "synthetic_bank_statement_v1",
      statementIdentifier: randomUUID(),
      sourceBankAccountId: `synthetic_${currency.toLowerCase()}`,
      accountId,
      currency,
      startsOn: "2026-10-01",
      endsOn: "2026-10-03",
      openingMinor,
      closingMinor: (BigInt(openingMinor) + BigInt(amountMinor)).toString(),
      completeness: { declaredComplete: true, basis: "Independent synthetic exchange source" },
      rows: [
        {
          rowOrdinal: 1,
          providerId: randomUUID(),
          date: "2026-10-03",
          description: "Synthetic currency exchange",
          amountMinor,
        },
      ],
    };
    const original = await post(book, "/evidence", {
      title,
      content: JSON.stringify(source),
      mediaType: "application/json",
      origin: "O24 synthetic bank source",
    });
    const imported = await post(book, "/bank-statements", {
      ...source,
      evidenceId: original.id,
      existingMatches: [],
    });

    return { statementId: imported.statement.id, rowOrdinal: 1 };
  }

  const fee = await post(book, "/evidence", {
    title: "Växlingsavi 3 okt.pdf",
    content: JSON.stringify({
      kind: "synthetic_foreign_cash_fee_v1",
      currency: "SEK",
      feeMinor: "5000",
    }),
    mediaType: "application/json",
    origin: "O24 synthetic fee declaration, no actual PDF or bank",
  });
  const review = await post(reviewer, "/banking/foreign-cash/reviews", {
    ...shared,
    kind: "exchange",
    date: "2026-10-03",
    sourceIdentity: randomUUID(),
    receiverAccountId: "account_bank",
    nativeMinor: "200000",
    nativeObservation,
    bookObservation,
    feeEvidenceId: fee.id,
    feeAccountId: "cash_fee",
    gainAccountId: "cash_gain",
    lossAccountId: "cash_loss",
  });
  const output = { accountId: "cash_eur", reviewId: review.id };

  await writeFile(
    join(config.artifacts, "foreign-cash-fixture.json"),
    JSON.stringify(output, null, 2),
  );

  return output;
}
