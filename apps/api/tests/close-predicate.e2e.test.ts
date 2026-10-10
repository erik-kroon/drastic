import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
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
import { signedSeptemberBank, vatConfiguration } from "./support/close-predicate";
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
        `select (select count(*) from openerp.close_predicate_captures where book_id=$1)::text captures,(select count(*) from openerp.command_receipts where book_id=$1)::text commands,(select count(*) from openerp.vouchers where book_id=$1)::text vouchers,(select committed_sequence::text from openerp.books where id=$1) sequence`,
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
    expect(check(initial, "supporting_documents").status).toBe("not_established");
    expect(check(initial, "complete_facts").status).toBe("not_established");
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
    expect(await observe(book)).toEqual(before);
    expect(await persisted(book)).toEqual(beforeFinancial);
    const source = await evidence(book);
    const j = journal(source.id, "100");
    const later = await post(
      book,
      "/change-sets",
      { ...j, accountingPeriodId: "period_october", postingDate: "2026-10-05" },
      Accounting.ChangeSet,
    );
    await execute(book, later);
    const unrelated = await decoded(await request(book, path), View);
    observations.unrelated = unrelated;
    expect(check(unrelated, "bank_reconciliation").freshness.status).toBe("fresh");
    expect(unrelated.capture).toEqual(saved.capture);
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
      { ...input, sourceCoverage: [] },
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
