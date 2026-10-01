import { expect, test } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Reports from "@open-erp/contracts/reports";
import * as Close from "@open-erp/contracts/financial-close";
import { database, decoded, environment, post, request } from "./support/fixtures";
import { withWorkspaceBrowser } from "./support/workspace-browser";
import {
  capture,
  closeApproval,
  closeFixture,
  closePath,
  controls,
  finalProposal,
  movement,
  recognizeTax,
  taxBridge,
} from "./support/financial-close";

const roles = [
  { accountId: "account_bank", role: "excluded" },
  { accountId: "account_clearing", role: "excluded" },
  { accountId: "account_income", role: "revenue" },
  { accountId: "account_expense", role: "operating_expense" },
  { accountId: "account_tax", role: "income_tax" },
  { accountId: "account_transfer", role: "other_expense" },
  { accountId: "account_equity", role: "excluded" },
];

test("DF-03 served profit-and-loss family preserves income and tax after owned financial close", async () => {
  const context = await closeFixture("75000");
  const { book } = context;
  await movement(book, "account_transfer", "account_bank", "5000");
  const basis = await taxBridge(context);
  await recognizeTax(context, basis.bridge);
  await controls(context);

  const trial = () =>
    post(
      book,
      "/report-snapshots",
      { kind: "trial_balance_v1", startsOn: "2026-01-01", endsOn: "2026-12-31" },
      Reports.ReportSnapshot,
    );

  const beforeTrial = await trial();

  const input = {
    kind: "profit_and_loss",
    sourceReportId: beforeTrial.id,
    mapping: { version: "synthetic_report_mapping_v1", reviewed: true, roles },
  };

  const before = await post(book, "/report-family-snapshots", input, Reports.ReportFamilySnapshot);
  expect(before.lines.find((line) => line.id === "revenue")?.amountMinor).toBe("75000");
  expect(before.lines.find((line) => line.id === "income_tax")?.amountMinor).toBe("14000");
  expect(before.lines.find((line) => line.id === "other_expense")?.amountMinor).toBe("5000");
  const proposal = await finalProposal(context, basis);
  const approval = await closeApproval(context, proposal);
  await post(
    book,
    `${closePath}/proposals/${proposal.id}/execute`,
    { version: 1, digest: proposal.digest, approvalId: approval.id },
    Close.FinancialCloseCertificate,
  );
  const afterTrial = await trial();

  const after = await post(
    book,
    "/report-family-snapshots",
    { ...input, sourceReportId: afterTrial.id },
    Reports.ReportFamilySnapshot,
  );

  expect(after.lines.find((line) => line.id === "revenue")?.amountMinor).toBe("75000");
  expect(after.lines.find((line) => line.id === "income_tax")?.amountMinor).toBe("14000");
  expect(after.lines.find((line) => line.id === "other_expense")?.amountMinor).toBe("5000");
  expect(after.lines.find((line) => line.id === "other_expense")?.movementMinor).toBe("61000");
  expect(after.lines.find((line) => line.id === "other_expense")?.resultTransferMinor).toBe(
    "56000",
  );
  expect(after.report.resultTransferVoucherIds).toHaveLength(1);
  expect(before.report.resultTransferVoucherIds).toEqual([]);

  const raw = await decoded(
    await request(book, `/report-snapshots/${afterTrial.id}/lines`),
    Reports.ReportLines,
  );

  expect(raw.items.find((line) => line.accountId === "account_transfer")?.closingMinor).toBe(
    "61000",
  );

  const explanation = await decoded(
    await request(book, `/report-snapshots/${after.report.id}/lines/account_transfer/explanation`),
    Reports.ReportExplanation,
  );

  expect(explanation.line.closingMinor).toBe("61000");
  expect(
    explanation.items
      .map((line) => line.debitMinor)
      .sort((left, right) =>
        BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0,
      ),
  ).toEqual(["5000", "56000"]);
  const semantic = await capture(book);
  expect(semantic.fiscalYtdProfitMinor).toBe("56000");

  const saved = await decoded(
    await request(book, `/report-family-snapshots/${before.report.id}`),
    Reports.ReportFamilySnapshot,
  );

  expect(saved).toEqual(before);

  const oldCutoffRecapture = await post(
    book,
    "/report-family-snapshots",
    input,
    Reports.ReportFamilySnapshot,
  );

  expect(oldCutoffRecapture.report.resultTransferVoucherIds).toEqual([]);
  expect(oldCutoffRecapture.lines).toEqual(before.lines);

  const response = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${book.agentToken}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "reports_get_family",
        arguments: {
          scope: { entityId: book.entityId, bookId: book.bookId },
          reportId: after.report.id,
        },
      },
    }),
  });

  expect(response.status).toBe(200);

  const rpc = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Literal(false),
        structuredContent: Schema.Struct({ result: Reports.ReportFamilySnapshot }),
      }),
    }),
  )(await response.json());

  expect(rpc.result.structuredContent.result).toEqual(after);
  // Preserve old family interpretation instead of rewriting retained numbers.
  const { profitBasis, resultTransferVoucherIds, ...oldHeader } = after.report;
  expect(profitBasis).toBe("owned_result_transfer_exclusion_v1");
  expect(resultTransferVoucherIds).toHaveLength(1);
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.report_snapshots(book_id,id,starts_on,ends_on,sequence,body) values($1,'report_legacy','2026-01-01','2026-12-31',$2,$3::jsonb)",
      [
        book.bookId,
        after.report.sequence,
        JSON.stringify({
          ...oldHeader,
          id: "report_legacy",
          warnings: ["Synthetic legacy snapshot without a transfer bridge"],
        }),
      ],
    );
    await admin.query(
      "insert into openerp.report_lines(book_id,report_id,account_id,body) select book_id,'report_legacy',account_id,body from openerp.report_lines where book_id=$1 and report_id=$2",
      [book.bookId, after.report.id],
    );
  } finally {
    await admin.end();
  }

  const legacy = await decoded(
    await request(book, "/report-family-snapshots/report_legacy"),
    Reports.ReportFamilySnapshot,
  );

  expect(legacy.lines.find((line) => line.id === "other_expense")?.amountMinor).toBe("61000");
  expect(legacy.report.profitBasis).toBeUndefined();
  expect(legacy.warnings.some((warning) => warning.includes("retained legacy P&L"))).toBe(true);
  await withWorkspaceBrowser(book, "df-03", async (page, workspace) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${workspace}/reports?view=profit_and_loss&record=${after.report.id}`);
    await page
      .getByText(
        "The mapped amount excludes the displayed result transfer. Movements, balances and account details retain the complete posted history.",
        { exact: true },
      )
      .waitFor();
    await page.getByText("Result transfer", { exact: true }).first().waitFor();
    await page.screenshot({
      path: join(environment().artifacts, "df-03-transfer-bridge.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
  await writeFile(
    join(environment().artifacts, "df-03-family-close.json"),
    JSON.stringify(
      {
        independentExpectation:
          "75000 income - 5000 ordinary expense - 14000 tax = 56000; the result transfer is not another cost",
        before,
        after,
        semantic,
        raw,
        explanation,
        saved,
        legacy,
        oldCutoffRecapture,
        mcp: rpc,
      },
      null,
      2,
    ),
  );
}, 120000);
