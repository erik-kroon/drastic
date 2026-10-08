import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Setup from "@open-erp/contracts/company-setup";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Intake from "@open-erp/contracts/source-intake";
import {
  createSession,
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

async function company() {
  const identity = await fixture();

  const session = await createSession(identity);

  const setup = await post(
    { ...identity, token: session.token, path: "/api/v1" },
    "/companies",
    { name: "Synthetic bank intake company" },
    Setup.CompanySetup,
  );

  const book = {
    ...identity,
    ...setup.scope,
    token: session.token,
    path: `/api/v1/entities/${setup.scope.entityId}/books/${setup.scope.bookId}`,
  };

  const ledger = await post(
    book,
    "/company-setup/native-ledger",
    {
      expectedRevision: setup.revision,
      startsOn: "2025-05-17",
      endsOn: "2026-04-30",
      accounts: [{ code: "1930", name: "Synthetic company bank" }],
    },
    Setup.NativeLedgerSetup,
  );

  return { book, accountId: ledger.accounts[0]!.id };
}

function source(accountId: string, kind = "synthetic_bank_statement_v1") {
  return {
    kind,
    statementIdentifier: "synthetic_company_first_statement",
    sourceBankAccountId: "synthetic_company_bank",
    accountId,
    currency: "SEK",
    startsOn: "2025-06-01",
    endsOn: "2025-06-30",
    openingMinor: "0",
    closingMinor: "2250000",
    completeness: { declaredComplete: false, basis: "Synthetic observed interval only" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2025-06-30",
        description: "Synthetic capital transfer",
        amountMinor: "2500000",
      },
      {
        rowOrdinal: 2,
        providerId: null,
        date: "2025-06-30",
        description: "Synthetic bank fee",
        amountMinor: "-250000",
      },
    ],
  };
}

async function retained(book: BookFixture, content: unknown) {
  return post(
    book,
    "/evidence",
    {
      title: "Synthetic native bank original",
      mediaType: "application/json",
      content: JSON.stringify(content),
      origin: "Native bank intake preimplementation fixture",
    },
    Accounting.Evidence,
  );
}

async function state(book: BookFixture) {
  const admin = await database();

  try {
    const rows = await admin.query(
      `select
      (select count(*)::int from openerp.bank_statements where book_id=$1) as statements,
      (select count(*)::int from openerp.bank_observations where book_id=$1) as observations,
      (select count(*)::int from openerp.bank_sources where book_id=$1) as sources`,
      [book.bookId],
    );

    return { intake: rows.rows[0], financial: await persisted(book) };
  } finally {
    await admin.end();
  }
}

test.each(["synthetic_bank_statement_v1", "bank_statement_v1"])(
  "native company retains %s and exact replay without postings or coverage promotion",
  async (kind) => {
    const { book, accountId } = await company();

    const original = source(accountId, kind);

    const evidence = await retained(book, original);

    const input = { ...original, evidenceId: evidence.id, existingMatches: [] };

    const commandKey = key();

    const before = await persisted(book);

    const receipt = await decoded(
      await request(book, "/bank-statements", {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(input),
      }),
      Bank.StatementImportReceipt,
    );

    const replay = await decoded(
      await request(book, "/bank-statements", {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify(input),
      }),
      Bank.StatementImportReceipt,
    );

    expect(replay).toEqual(receipt);

    expect(receipt.statement.closingMinor).toBe("2250000");

    expect(receipt.statement.completeness.declaredComplete).toBe(false);

    expect(receipt.matches).toEqual([]);

    const view = await decoded(
      await request(book, `/bank-statements/${receipt.statement.id}`),
      Bank.BankStatementView,
    );

    expect(view.statement.rows.map((row) => row.amountMinor)).toEqual(["2500000", "-250000"]);

    expect(await persisted(book)).toEqual(before);

    const after = await state(book);

    expect(after.intake).toEqual({ statements: 1, observations: 2, sources: 1 });

    await writeFile(
      join(environment().artifacts, `native-bank-${kind}.json`),
      JSON.stringify({ before, receipt, view, after }, null, 2),
    );

    await failure(
      await request(book, "/bank-statements", {
        method: "POST",
        headers: { "idempotency-key": commandKey },
        body: JSON.stringify({ ...input, closingMinor: "0" }),
      }),
      409,
      "IdempotencyConflict",
    );

    expect(await state(book)).toEqual(after);
  },
);

test("native company reviews and admits retained CSV bytes without posting", async () => {
  const { book, accountId } = await company();

  const csv =
    "date,text,amount\n2025-06-30,Synthetic capital transfer,25000.00\n2025-06-30,Synthetic bank fee,-2500.00\n";

  const occurrence = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "Synthetic CSV export",
      sourceAccountId: "synthetic_company_bank",
      occurrenceKey: "synthetic_company_csv_1",
      sourceRevision: "v1",
      filename: "synthetic-company-bank.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from(csv).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const preview = await post(
    book,
    `/source-occurrences/${occurrence.id}/previews`,
    {
      profile: "bank_csv_utf8_v1",
      delimiter: ",",
      lineEnding: "lf",
      dateColumn: "date",
      descriptionColumn: "text",
      amountColumn: "amount",
      providerIdColumn: null,
      dateFormat: "YYYY-MM-DD",
      decimalSeparator: ".",
      sign: "inflow_positive",
      accountId,
      currency: "SEK",
      currencyScale: 2,
      startsOn: "2025-06-01",
      endsOn: "2025-06-30",
      openingMinor: "0",
      closingMinor: "2250000",
      completeness: { declaredComplete: false, basis: "Synthetic observed interval only" },
    },
    Intake.SourcePreview,
  );

  expect(preview.ready).toBe(true);

  expect(preview.statement?.kind).toBe("bank_statement_v1");

  expect(preview.movementMinor).toBe("2250000");

  const approval = await post(
    book,
    `/source-previews/${preview.id}/approve`,
    {
      digest: preview.digest,
      version: 1,
      rationale: "Synthetic exact source review",
    },
    Intake.SourceApproval,
  );

  const before = await persisted(book);

  const admitted = await post(
    book,
    `/source-previews/${preview.id}/admit`,
    {
      digest: preview.digest,
      version: 1,
      approvalId: approval.id,
    },
    Intake.SourceAdmission,
  );

  expect(admitted.imported.statement.rows.map((row) => row.amountMinor)).toEqual([
    "2500000",
    "-250000",
  ]);

  expect(await persisted(book)).toEqual(before);

  const original = await decoded(
    await request(book, `/source-occurrences/${occurrence.id}`),
    Intake.SourceOccurrenceView,
  );

  expect(Buffer.from(original.contentBase64, "base64").toString()).toBe(csv);

  await writeFile(
    join(environment().artifacts, "native-bank-csv.json"),
    JSON.stringify(
      { occurrence, preview, approval, admitted, before, after: await state(book) },
      null,
      2,
    ),
  );
});

test.each([
  "wrong_currency",
  "foreign_account",
  "bad_balance",
  "changed_evidence",
  "inactive_account",
])("native bank intake refuses %s atomically", async (gap) => {
  const { book, accountId } = await company();

  const original = source(accountId);

  const evidence = await retained(book, original);

  const input = { ...original, evidenceId: evidence.id, existingMatches: [] };

  if (gap === "wrong_currency") input.currency = "EUR";

  if (gap === "foreign_account") input.accountId = "account_bank";

  if (gap === "bad_balance") input.closingMinor = "1";

  if (gap === "changed_evidence")
    input.rows = original.rows.map((row) => ({ ...row, description: "Changed" }));

  if (gap === "inactive_account") {
    const admin = await database();

    try {
      await admin.query("update openerp.accounts set active=false where book_id=$1 and id=$2", [
        book.bookId,
        accountId,
      ]);
    } finally {
      await admin.end();
    }
  }

  const before = await state(book);

  await failure(
    await request(book, "/bank-statements", { method: "POST", body: JSON.stringify(input) }),
    422,
    gap === "changed_evidence" ? "MissingEvidence" : "InvalidJournal",
  );

  expect(await state(book)).toEqual(before);
});
