import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reports from "@open-erp/contracts/reports";
import {
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";

test("company setup internal ledger reads preserve recorded openings, cutoff and financial fences", async () => {
  const book = await fixture();

  const source = await evidence(book);

  const opening = await post(
    book,
    "/change-sets",
    { ...journal(source.id, "12500"), postingDate: "2026-01-10" },
    Accounting.ChangeSet,
  );

  await execute(book, opening);

  const movement = await post(
    book,
    "/change-sets",
    { ...journal(source.id, "250"), postingDate: "2026-09-22" },
    Accounting.ChangeSet,
  );

  await execute(book, movement);

  const admin = await database();

  try {
    await admin.query("update openerp.books set profile='company-setup-v1' where id=$1", [
      book.bookId,
    ]);
  } finally {
    await admin.end();
  }

  const before = await persisted(book);

  const commandKey = key();

  const input = { kind: "trial_balance_v1", startsOn: "2026-09-01", endsOn: "2026-09-30" };

  const capture = () =>
    request(book, "/report-snapshots", {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(input),
    });

  const report = await decoded(await capture(), Reports.ReportSnapshot);

  expect(report).toMatchObject({
    accountCount: 2,
    voucherCount: 1,
    debitMinor: "250",
    creditMinor: "250",
    balanced: true,
    coverage: "not_established",
  });

  expect(report.warnings).toContain(
    "Internal ledger trial balance only; not a statutory financial statement.",
  );

  expect(await decoded(await capture(), Reports.ReportSnapshot)).toEqual(report);

  const lines = await decoded(
    await request(book, `/report-snapshots/${report.id}/lines`),
    Reports.ReportLines,
  );

  expect(lines.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: "account_bank",
        openingMinor: "12500",
        closingMinor: "12750",
      }),
      expect.objectContaining({
        accountId: "account_clearing",
        openingMinor: "-12500",
        closingMinor: "-12750",
      }),
    ]),
  );

  const explanation = await decoded(
    await request(book, `/report-snapshots/${report.id}/lines/account_bank/explanation`),
    Reports.ReportExplanation,
  );

  expect(explanation.items).toHaveLength(2);

  expect(explanation.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ part: "opening", debitMinor: "12500" }),
      expect.objectContaining({ part: "movement", debitMinor: "250" }),
    ]),
  );

  const generalLedger = await decoded(
    await request(book, `/report-snapshots/${report.id}/lines/account_bank/general-ledger`),
    Reports.GeneralLedgerPage,
  );

  expect(generalLedger).toMatchObject({ pageOpeningMinor: "12500", pageClosingMinor: "12750" });

  expect(generalLedger.items).toHaveLength(1);

  const postingRefusal = await request(book, "/change-sets", {
    method: "POST",
    body: JSON.stringify(journal(source.id)),
  });

  const postingRefusalBody = await postingRefusal.clone().json();

  await failure(postingRefusal, 422, "UnsupportedProfile");

  const statementRefusal = await request(book, "/report-family-snapshots", {
    method: "POST",
    body: JSON.stringify({
      kind: "profit_and_loss",
      sourceReportId: report.id,
      mapping: {
        version: "synthetic_report_mapping_v1",
        reviewed: true,
        roles: [
          { accountId: "account_bank", role: "excluded" },
          { accountId: "account_clearing", role: "excluded" },
        ],
      },
    }),
  });

  const statementRefusalBody = await statementRefusal.clone().json();

  await failure(statementRefusal, 422, "UnsupportedProfile");

  const afterRead = await persisted(book);

  expect(afterRead).toEqual(before);

  const outsider = await fixture();

  await failure(
    await request(book, `/report-snapshots/${report.id}`, {
      headers: { authorization: `Bearer ${outsider.token}` },
    }),
    403,
    "Forbidden",
  );

  await failure(
    await request(book, "/report-snapshots", {
      method: "POST",
      body: JSON.stringify({ ...input, startsOn: "2026-10-01" }),
    }),
    422,
    "InvalidJournal",
  );

  const later = await database();

  try {
    await later.query("update openerp.books set profile='synthetic-core-v1' where id=$1", [
      book.bookId,
    ]);
  } finally {
    await later.end();
  }

  await execute(
    book,
    await post(
      book,
      "/change-sets",
      {
        ...journal(source.id, "100"),
        postingDate: "2026-09-23",
      },
      Accounting.ChangeSet,
    ),
  );

  const change = await database();

  try {
    await change.query("update openerp.books set profile='company-setup-v1' where id=$1", [
      book.bookId,
    ]);
    await change.query(
      "update openerp.accounts set name='Renamed after snapshot' where book_id=$1 and id='account_bank'",
      [book.bookId],
    );
  } finally {
    await change.end();
  }

  expect(
    await decoded(await request(book, `/report-snapshots/${report.id}/lines`), Reports.ReportLines),
  ).toEqual(lines);

  expect(
    await decoded(
      await request(book, `/report-snapshots/${report.id}/lines/account_bank/general-ledger`),
      Reports.GeneralLedgerPage,
    ),
  ).toEqual(generalLedger);

  await writeFile(
    join(environment().artifacts, "company-ledger-read.json"),
    JSON.stringify(
      {
        scope: { entityId: book.entityId, bookId: book.bookId },
        report,
        lines,
        explanation,
        generalLedger,
        financialStateBeforeRead: before,
        financialStateAfterRead: afterRead,
        unchangedScope:
          "snapshot capture, replay, drilldown and refused financial operations before the later synthetic posting",
        postingRefusal: { status: postingRefusal.status, body: postingRefusalBody },
        statementRefusal: { status: statementRefusal.status, body: statementRefusalBody },
        sourceClass:
          "synthetic fixture with a company-setup profile; no actual-company posting qualification",
      },
      null,
      2,
    ),
  );
});

test("an empty company setup ledger remains unqualified and an unknown profile stays refused", async () => {
  const book = await fixture();

  const admin = await database();

  try {
    await admin.query("update openerp.books set profile='company-setup-v1' where id=$1", [
      book.bookId,
    ]);
  } finally {
    await admin.end();
  }

  const report = await post(
    book,
    "/report-snapshots",
    {
      kind: "trial_balance_v1",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    },
    Reports.ReportSnapshot,
  );

  expect(report).toMatchObject({
    voucherCount: 0,
    debitMinor: "0",
    creditMinor: "0",
    coverage: "not_established",
  });

  expect(report.warnings).toContain(
    "A balanced ledger does not establish complete source records, tax correctness or period readiness.",
  );

  const unknown = await database();

  try {
    await unknown.query(
      "update openerp.books set profile='unqualified-future-profile' where id=$1",
      [book.bookId],
    );
  } finally {
    await unknown.end();
  }

  await failure(
    await request(book, "/report-snapshots", {
      method: "POST",
      body: JSON.stringify({
        kind: "trial_balance_v1",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
      }),
    }),
    422,
    "UnsupportedProfile",
  );
});
