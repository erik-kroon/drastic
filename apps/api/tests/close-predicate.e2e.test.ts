import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Source from "@open-erp/contracts/source-intake";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Workspace from "@open-erp/contracts/workspace";
import { Client } from "pg";
import {
  createSession,
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  persisted,
  post,
  request,
} from "./support/fixtures";
import {
  signedSeptemberBank,
  vatConfiguration,
  incompleteSeptemberCoverage,
} from "./support/close-predicate";
const periods = [
  { id: "period_september", startsOn: "2026-09-01", endsOn: "2026-09-30" },
  { id: "period_october", startsOn: "2026-10-01", endsOn: "2026-10-31" },
];
const Check = Schema.Struct({
  checkId: Schema.String,
  status: Schema.String,
  reasons: Schema.Array(Schema.String),
  freshness: Schema.Struct({ status: Schema.String, reasons: Schema.Array(Schema.String) }),
  observedCutoff: Schema.Struct({
    ledgerSequence: Schema.String,
    dependencyDigests: Schema.Record(Schema.String, Schema.String),
  }),
  evidenceRefs: Schema.Array(
    Schema.Struct({ owner: Schema.String, id: Schema.String, digest: Schema.String }),
  ),
  builderVersion: Schema.String,
});
const View = Schema.Struct({
  scope: Accounting.Scope,
  period: Schema.Struct({
    id: Schema.String,
    startsOn: Schema.String,
    endsOn: Schema.String,
    version: Schema.String,
  }),
  capture: Schema.NullOr(
    Schema.Struct({ id: Schema.String, digest: Schema.String, createdAt: Schema.String }),
  ),
  gated: Schema.Array(Check),
  reported: Schema.Array(Check),
  verdict: Schema.String,
});
const path = "/periods/period_september/close-predicate";
function check(view: typeof View.Type, id: string) {
  const found = view.gated.find((c) => c.checkId === id);
  if (!found) throw new Error(`Missing gated ${id}`);
  return found;
}
async function save(name: string, value: unknown) {
  await writeFile(join(environment().artifacts, name), JSON.stringify(value, null, 2));
}
async function capture(
  book: Awaited<ReturnType<typeof fixture>>,
  input: unknown,
  key = randomUUID(),
) {
  return decoded(
    await request(book, path, {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify(input),
    }),
    View,
  );
}
async function observe(book: Awaited<ReturnType<typeof fixture>>) {
  const admin = await database();
  try {
    return (
      await admin.query(
        `select (select count(*) from openerp.close_predicate_captures where book_id=$1)::text captures,(select count(*) from openerp.command_receipts where book_id=$1)::text commands,(select count(*) from openerp.vouchers where book_id=$1)::text vouchers,(select count(*) from openerp.execution_receipts where book_id=$1)::text receipts,(select count(*) from openerp.outbox where book_id=$1)::text outbox,(select count(*) from public.effect_mq_jobs where metadata->>'bookId'=$1)::text queue_jobs,(select committed_sequence::text from openerp.books where id=$1) sequence`,
        [book.bookId],
      )
    ).rows[0];
  } finally {
    await admin.end();
  }
}
test("AUT06 monthly bank capture preserves outcomes, owner freshness, replay and read-only MCP", async () => {
  const book = await fixture([], periods);
  const sessionBook = { ...book, token: (await createSession(book)).token };
  const observations: Record<string, unknown> = {};
  try {
    const initial = await decoded(await request(book, path), View);
    observations.initial = initial;
    expect(initial.capture).toBeNull();
    expect(check(initial, "bank_reconciliation").status).toBe("not_run");
    expect(check(initial, "vouchers_supported").status).toBe("not_established");
    expect(check(initial, "facts_complete").status).toBe("not_established");
    expect(initial.verdict).toBe("inconclusive");
    const signed = await signedSeptemberBank(sessionBook);
    const input = { bankInventoryPlanId: signed.plan.id, actualVatReturnId: null };
    const key = randomUUID();
    const [saved, replayed] = await Promise.all([
      capture(book, input, key),
      capture(book, input, key),
    ]);
    observations.saved = saved;
    expect(saved.capture).not.toBeNull();
    expect(replayed.capture).toEqual(saved.capture);
    expect(check(saved, "bank_reconciliation").status).toBe("pass");
    expect(check(saved, "bank_reconciliation").freshness.status).toBe("fresh");
    expect(saved.verdict).toBe("inconclusive");
    expect(saved.reported.every((c) => c.status !== "pass")).toBe(true);
    const runtime = new Client({ connectionString: environment().runtimeUrl });
    await runtime.connect();
    try {
      await expect(
        runtime.query("UPDATE openerp.close_predicate_captures SET body=body WHERE book_id=$1", [
          book.bookId,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        runtime.query("DELETE FROM openerp.close_predicate_captures WHERE book_id=$1", [
          book.bookId,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtime.end();
    }
    await failure(
      await request(book, path, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ ...input, bankInventoryPlanId: null }),
      }),
      409,
      "IdempotencyConflict",
    );
    const other = await fixture([], periods);
    await failure(
      await request(other, path, { method: "POST", body: JSON.stringify(input) }),
      404,
      "NotFound",
    );
    await failure(
      await request(book, "/periods/period_october/close-predicate", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      422,
      "InvalidJournal",
    );
    const annual = await fixture();
    await failure(
      await request(annual, "/periods/period_2026/close-predicate", {
        method: "POST",
        body: JSON.stringify({ bankInventoryPlanId: null, actualVatReturnId: null }),
      }),
      422,
      "InvalidJournal",
    );
    const partial = await fixture(
      [],
      [{ id: "period_september", startsOn: "2026-09-02", endsOn: "2026-09-30" }],
    );
    await failure(
      await request(partial, path, {
        method: "POST",
        body: JSON.stringify({ bankInventoryPlanId: null, actualVatReturnId: null }),
      }),
      422,
      "InvalidJournal",
    );
    const before = await observe(book);
    const beforeFinancial = await persisted(book);
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
          name: "periods_close_predicate",
          arguments: {
            scope: { entityId: book.entityId, bookId: book.bookId },
            periodId: "period_september",
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const rpc = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({
          isError: Schema.Literal(false),
          structuredContent: Schema.Struct({ result: View }),
        }),
      }),
    )(await response.json());
    observations.mcp = rpc.result.structuredContent.result;
    expect(rpc.result.structuredContent.result.capture).toEqual(saved.capture);
    const after = await observe(book);
    observations.readOnly = { before, after, financial: beforeFinancial };
    expect(after).toEqual(before);
    expect(await persisted(book)).toEqual(beforeFinancial);
    const source = await evidence(book);
    const j = journal(source.id, "100");
    const later = await post(
      book,
      "/change-sets",
      { ...j, accountingPeriodId: "period_october", postingDate: "2026-10-05" },
      Accounting.ChangeSet,
    );
    const unrelated = await decoded(await request(book, path), View);
    observations.unrelated = unrelated;
    expect(check(unrelated, "bank_reconciliation").freshness.status).toBe("fresh");
    expect(unrelated.capture).toEqual(saved.capture);
    await execute(book, later);
    const inventoryStale = await decoded(await request(book, path), View);
    observations.inventoryGlobalLedger = inventoryStale;
    expect(check(inventoryStale, "bank_reconciliation").freshness.status).toBe("stale");
    const relevant = await post(
      book,
      "/change-sets",
      { ...journal((await evidence(book)).id, "100"), accountingPeriodId: "period_september" },
      Accounting.ChangeSet,
    );
    await execute(book, relevant);
    const stale = await decoded(await request(book, path), View);
    observations.stale = stale;
    expect(check(stale, "bank_reconciliation").status).toBe("pass");
    expect(check(stale, "bank_reconciliation").freshness.status).toBe("stale");
    expect(stale.capture).toEqual(saved.capture);
    expect((await capture(book, input, key)).capture).toEqual(saved.capture);
  } finally {
    await save("close-predicate-bank.json", observations);
  }
}, 180000);
test("AUT06 actual VAT zero without coverage remains incomplete and global ledger rule is retained", async () => {
  const book = await fixture(
    [
      { id: "account_input_vat", code: "2641", name: "Synthetic input VAT" },
      { id: "account_vat_settlement", code: "2650", name: "Synthetic settlement" },
      { id: "account_vat", code: "2611", name: "Synthetic output VAT" },
    ],
    periods,
  );
  const observations: Record<string, unknown> = {};
  try {
    const source = await evidence(book);
    await vatConfiguration({ book }, source.id);
    const input = {
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      periodEvidenceId: source.id,
      openingEvidenceId: source.id,
      controlOpenings: ["account_vat", "account_input_vat", "account_vat_settlement"].map(
        (accountId) => ({ accountId, signedMinor: "0" }),
      ),
      sourceCoverage: ["purchase_ledger", "sales_ledger"].map((family) => ({
        family,
        state: "current",
        evidenceId: source.id,
      })),
      rationale: "Explicit synthetic empty source inventory",
    };
    const vat = await post(book, "/vat-returns/actuals", input, Vat.ActualVatReturn);
    observations.vat = vat;
    expect(vat.calculation.coverageComplete).toBe(true);
    expect(vat.calculation.controlsReconciled).toBe(true);
    const saved = await capture(book, { bankInventoryPlanId: null, actualVatReturnId: vat.id });
    observations.saved = saved;
    expect(check(saved, "vat_control").status).toBe("pass");
    expect(saved.verdict).toBe("inconclusive");
    const original = await post(
      book,
      "/source-occurrences",
      {
        sourceSystem: "close_predicate_fixture",
        sourceAccountId: "synthetic_inbox",
        occurrenceKey: randomUUID(),
        sourceRevision: "1",
        filename: "missing.txt",
        mediaType: "text/plain",
        contentBase64: Buffer.from("Synthetic unresolved supporting original").toString("base64"),
      },
      Source.SourceOccurrence,
    );
    await post(
      book,
      "/commerce/supplier-inbox",
      { occurrenceId: original.id, channel: "upload", messageIdentity: null },
      Inbox.SupplierInboxView,
    );
    const target = { kind: "document", recordId: original.id } as const;
    const questionBasis = await post(
      book,
      "/workspace/questions/read",
      target,
      Workspace.WorkQuestionsView,
    );
    const sessionBook = { ...book, token: (await createSession(book)).token };
    const asked = await post(
      sessionBook,
      "/workspace/questions",
      {
        target,
        expectedTargetRevision: questionBasis.owner.revision,
        kind: "missing_evidence",
        question: "Please retain the missing synthetic receipt",
        requestedFrom: book.actorId,
      },
      Workspace.WorkQuestionResult,
    );
    observations.question = asked.question;
    const open = await capture(book, { bankInventoryPlanId: null, actualVatReturnId: vat.id });
    observations.openReviews = open;
    expect(check(open, "reviews_and_questions").status).toBe("fail");
    expect(
      check(open, "reviews_and_questions").evidenceRefs.some((ref) => ref.id === asked.question.id),
    ).toBe(true);
    const later = await post(
      book,
      "/change-sets",
      {
        ...journal((await evidence(book)).id, "100"),
        accountingPeriodId: "period_october",
        postingDate: "2026-10-05",
      },
      Accounting.ChangeSet,
    );
    await execute(book, later);
    const stale = await decoded(await request(book, path), View);
    observations.stale = stale;
    expect(check(stale, "vat_control").status).toBe("pass");
    expect(check(stale, "vat_control").freshness.status).toBe("stale");
    expect(check(stale, "vat_control").freshness.reasons).toContain("ledger_boundary_moved");
    const incomplete = await post(
      book,
      "/vat-returns/actuals",
      {
        ...input,
        sourceCoverage: input.sourceCoverage.map((row) => ({
          ...row,
          state: "unknown",
          evidenceId: null,
        })),
      },
      Vat.ActualVatReturn,
    );
    observations.incomplete = incomplete;
    expect(incomplete.calculation.coverageComplete).toBe(false);
    const failed = await capture(book, {
      bankInventoryPlanId: null,
      actualVatReturnId: incomplete.id,
    });
    observations.failed = failed;
    expect(check(failed, "vat_control").status).toBe("fail");
    expect(failed.verdict).toBe("inconclusive");
  } finally {
    await save("close-predicate-vat.json", observations);
  }
}, 180000);

test("AUT06 missing bank mappings, statements and continuity cannot pass at zero arithmetic", async () => {
  const observed = [];
  try {
    for (const mode of ["missing", "continuity", "incomplete"] as const) {
      const book = await fixture([], periods);
      const sessionBook = { ...book, token: (await createSession(book)).token };
      const report = await incompleteSeptemberCoverage(sessionBook, mode);
      expect(report.hasReviewGaps).toBe(true);
      if (mode === "missing") {
        expect(report.accounts[0]?.diagnostics).toContain("source_mapping_missing");
        expect(report.accounts[0]?.diagnostics).toContain("statements_missing");
      }
      if (mode === "continuity")
        expect(report.accounts[0]?.gaps).toEqual([
          { startsOn: "2026-09-16", endsOn: "2026-09-30" },
        ]);
      if (mode === "incomplete")
        expect(report.accounts[0]?.statements[0]?.diagnostics).toContain(
          "statement_declared_incomplete",
        );
      const result = await capture(book, {
        bankInventoryPlanId: null,
        bankSourceCoverageReportId: report.id,
        actualVatReturnId: null,
      });
      observed.push({ mode, report, result });
      expect(check(result, "bank_reconciliation").status).toBe("fail");
      expect(
        check(result, "bank_reconciliation").evidenceRefs.some(
          (ref) => ref.id === report.id && ref.digest === report.digest,
        ),
      ).toBe(true);
      expect(result.verdict).toBe("inconclusive");
    }
  } finally {
    await save("close-predicate-missing-bank.json", observed);
  }
}, 180000);
