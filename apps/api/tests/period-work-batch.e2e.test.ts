import { provenanceRows } from "./support/decision-provenance";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as PeriodWork from "@open-erp/contracts/period-work";
import * as Domain from "@open-erp/domain/period-work";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Owners from "@open-erp/contracts/owner-register";
import * as SupplierDrafts from "@open-erp/contracts/supplier-invoice-drafts";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import {
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  post,
  request,
} from "./support/fixtures";
import {
  acceptDraft,
  createDraft,
  supplierFixture,
  purchaseEvidence,
} from "./support/supplier-review";

async function preparedBatch() {
  const local = await supplierFixture();
  const { book } = local;
  const admin = await database();

  try {
    await admin.query(
      `insert into openerp.accounts(book_id,id,code,name)
      values($1,'account_second','1940','Synthetic second account')`,
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  const children = [];

  for (let index = 0; index < 2; index++) {
    const source = await purchaseEvidence(book, index);

    const draft = await createDraft(book, {
      ...local.content,
      sourceEvidenceId: source.id,
      supplierDocumentNumber: `BATCH-${index}`,
      lines: local.content.lines.map((line) => ({ ...line, taxEvidenceId: source.id })),
    });

    children.push({
      workIdentity: `period_work_${String(index + 1).padStart(32, "0")}`,
      economicIdentity: draft.id,
      sourceRevision: draft.revision,
      sourceSystem: "supplier_draft",
      sourceId: draft.id,
      documentClass: "domestic_invoice" as const,
      currency: "SEK",
      legalSupplierIdentity: local.supplier.id,
      qualifiedTreatmentId: "synthetic_treatment",
      evidenceIds: [source.id],
      sourceMinor: "10000",
      isPaymentObservation: false,
      existingMatches: [],
      dependsOn: [],
      intendedOwner: "purchases.recognition" as const,
      prepareInput: {
        profile: "synthetic-manual-supplier-v1",
        draftId: draft.id,
        expectedRevision: draft.revision,
        expectedDigest: draft.digest,
        controlAccountId: "account_clearing",
        debitAccountId: index === 0 ? "account_bank" : "account_second",
        accountingPeriodId: "period_2026",
        series: "A",
        reason: "Synthetic batch qualification",
        acknowledgeSyntheticOnly: true,
      },
    });
  }

  const manifest = await post(
    book,
    "/period-work/manifests",
    {
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      cutoff: "2026-12-31",
      children,
      rules: [
        {
          id: "synthetic_rule",
          version: 1,
          legalSupplierIdentity: local.supplier.id,
          supportedDocumentClass: "domestic_invoice",
          currency: "SEK",
          qualifiedTreatmentId: "synthetic_treatment",
          acceptedEvidenceRequirements: [],
          operationFamily: "SupplierRecognition",
          approvedExamples: [],
          negativeExamples: [],
          activationReview: "synthetic_review",
        },
      ],
      populationComplete: false,
      excluded: [],
      acknowledgeNotReconciled: true,
    },
    Domain.PeriodWorkManifest,
  );

  const progress = await post(
    book,
    `/period-work/manifests/${manifest.id}/advance`,
    { boundedCount: 2 },
    PeriodWork.PeriodWorkRunProgress,
  );

  expect(progress.children.map((child) => child.state)).toEqual(["prepared", "prepared"]);

  const batch = await post(
    book,
    "/period-work/batches",
    { manifestId: manifest.id, workIdentities: children.map((child) => child.workIdentity) },
    PeriodWork.ApprovalBatch,
  );

  const batchPath = `/period-work/batches/${batch.id}`;

  expect(batch.combinedInformationalMinor).toBe("20000");
  expect(
    batch.members
      .map((member) => member.workIdentity)
      .sort((left, right) => left.localeCompare(right)),
  ).toEqual(
    children.map((child) => child.workIdentity).sort((left, right) => left.localeCompare(right)),
  );
  expect(batch.members.map((member) => member.planId)).toEqual(
    batch.members.map((member) => member.planId).sort((left, right) => left.localeCompare(right)),
  );

  return { book, manifest, progress, batch, batchPath };
}

test.each(["aggregate", "child"] as const)(
  "approved period batch recovers %s checkpoint loss with exact mixed receipts",
  async (checkpoint) => {
    const { book, manifest, progress, batch, batchPath } = await preparedBatch();

    expect(await decoded(await request(book, batchPath), PeriodWork.ApprovalBatch)).toEqual(batch);
    await failure(
      await request({ ...book, token: book.agentToken }, `${batchPath}/approvals`, {
        method: "POST",
        body: JSON.stringify({ expectedDigest: batch.digest, acknowledgeSyntheticOnly: true }),
      }),
      403,
      "Forbidden",
    );
    await failure(
      await request(book, `${batchPath}/approvals`, {
        method: "POST",
        body: JSON.stringify({
          expectedDigest: `sha256:${"f".repeat(64)}`,
          acknowledgeSyntheticOnly: true,
        }),
      }),
      409,
      "StaleDependency",
    );
    await post(
      book,
      `${batchPath}/approvals`,
      { expectedDigest: batch.digest, acknowledgeSyntheticOnly: true },
      PeriodWork.ApprovalBatch,
    );
    const provenance = await provenanceRows(book);
    expect(provenance).toHaveLength(batch.members.length);
    expect(provenance.every((row) => row.classification === "batch_approved")).toBe(true);
    const changed = await database();

    try {
      await changed.query(
        "update openerp.accounts set active=false,version=version+1 where book_id=$1 and id='account_second'",
        [book.bookId],
      );
    } finally {
      await changed.end();
    }

    const executionKey = key();

    const execute = {
      method: "POST",
      headers: { "idempotency-key": executionKey },
      body: JSON.stringify({
        expectedDigest: batch.digest,
        boundedCount: 2,
        acknowledgeSyntheticOnly: true,
      }),
    };

    const fault = await database();

    try {
      await fault.query(`create function openerp.synthetic_batch_result_failure() returns trigger
      language plpgsql as $$begin raise exception 'synthetic lost aggregate checkpoint'; end$$`);

      if (checkpoint === "aggregate") {
        await fault.query(`create trigger synthetic_batch_result_failure before insert
        on openerp.period_work_execution_results for each row execute function openerp.synthetic_batch_result_failure()`);
      } else {
        await fault.query(`create trigger synthetic_batch_result_failure before update
        on openerp.period_work_children for each row when (new.state='committed')
        execute function openerp.synthetic_batch_result_failure()`);
      }

      // P0001 is the repository's InternalError/outcome-unknown classification.
      await failure(await request(book, `${batchPath}/execute`, execute), 500, "InternalError");
      await failure(await request(book, `${batchPath}/results/${executionKey}`), 404, "NotFound");
      expect(
        (
          await fault.query(
            "select count(*)::int as count from openerp.vouchers where book_id=$1",
            [book.bookId],
          )
        ).rows,
      ).toEqual([{ count: 1 }]);
    } finally {
      await fault.query(
        "drop trigger if exists synthetic_batch_result_failure on openerp.period_work_execution_results",
      );
      await fault.query(
        "drop trigger if exists synthetic_batch_result_failure on openerp.period_work_children",
      );
      await fault.query("drop function if exists openerp.synthetic_batch_result_failure()");
      await fault.end();
    }

    const result = await decoded(
      await request(book, `${batchPath}/execute`, execute),
      PeriodWork.PeriodWorkExecutionResult,
    );

    expect(result.committed).toHaveLength(1);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]?.reason).toBe("StaleDependency");
    expect(result.reconciled).toBe(false);
    expect(
      await decoded(
        await request(book, `${batchPath}/execute`, execute),
        PeriodWork.PeriodWorkExecutionResult,
      ),
    ).toEqual(result);

    const recovered = await decoded(
      await request(book, `${batchPath}/results/${executionKey}`),
      PeriodWork.PeriodWorkExecutionResult,
    );

    expect(recovered).toEqual(result);
    await failure(
      await request(book, `${batchPath}/execute`, {
        ...execute,
        body: JSON.stringify({
          expectedDigest: batch.digest,
          boundedCount: 1,
          acknowledgeSyntheticOnly: true,
        }),
      }),
      409,
      "IdempotencyConflict",
    );
    const foreign = await fixture();

    await failure(await request(foreign, `${batchPath}/results/${executionKey}`), 404, "NotFound");

    const mcp = await decoded(
      await fetch(`${environment().baseUrl}/api/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${book.agentToken}`,
          "content-type": "application/json",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "period_work_get_batch_result",
            arguments: {
              scope: { entityId: book.entityId, bookId: book.bookId },
              batchId: batch.id,
              key: executionKey,
            },
          },
        }),
      }),
      Schema.Struct({
        result: Schema.Struct({
          structuredContent: Schema.Struct({
            result: PeriodWork.PeriodWorkExecutionResult,
          }),
        }),
      }),
    );

    expect(mcp.result.structuredContent.result).toEqual(result);
    const persisted = await database();

    try {
      expect(
        (
          await persisted.query(
            "select count(*)::int as count from openerp.vouchers where book_id=$1",
            [book.bookId],
          )
        ).rows,
      ).toEqual([{ count: 1 }]);
      expect(
        (
          await persisted.query(
            "select sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1",
            [book.bookId],
          )
        ).rows,
      ).toEqual([{ debit: "10000", credit: "10000" }]);
    } finally {
      await persisted.end();
    }

    await writeFile(
      join(environment().artifacts, `period-batch-${checkpoint}-mixed-recovery.json`),
      JSON.stringify(
        {
          manifest,
          progress,
          batch,
          result,
          recovered,
          provenance,
          expected: { vouchers: 1, debit: "10000", credit: "10000" },
        },
        null,
        2,
      ),
    );
  },
);

test("committed reviewer revocation refuses every approved batch member without posting", async () => {
  const { book, batch, batchPath } = await preparedBatch();
  const independent = await fixture();
  const reviewer = { ...book, token: independent.token, actorId: independent.actorId };
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await post(
      reviewer,
      `${batchPath}/approvals`,
      { expectedDigest: batch.digest, acknowledgeSyntheticOnly: true },
      PeriodWork.ApprovalBatch,
    );
    await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
      book.bookId,
      reviewer.actorId,
    ]);

    const result = await post(
      book,
      `${batchPath}/execute`,
      { expectedDigest: batch.digest, boundedCount: 2, acknowledgeSyntheticOnly: true },
      PeriodWork.PeriodWorkExecutionResult,
    );

    expect(result.committed).toEqual([]);
    expect(result.refused.map((member) => member.reason)).toEqual([
      "ApprovalRequired",
      "ApprovalRequired",
    ]);
    expect(
      (
        await admin.query("select count(*)::int as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: 0 }]);
    await writeFile(
      join(environment().artifacts, "period-batch-reviewer-revocation.json"),
      JSON.stringify({ batch, reviewer: reviewer.actorId, result, expectedVouchers: 0 }, null, 2),
    );
  } finally {
    await admin.end();
  }
});

test("owner expense batch preserves private payment lineage without posting company cash", async () => {
  const local = await supplierFixture();
  const { book } = local;
  const independent = await fixture();
  const reviewer = { ...book, token: independent.token, actorId: independent.actorId };
  const setup = await database();

  try {
    await setup.query(
      `insert into openerp.accounts(book_id,id,code,name) values
      ($1,'account_owner','2893','Synthetic owner liability'),
      ($1,'account_vat','2641','Synthetic input VAT'),
      ($1,'account_expense','6991','Synthetic expense')`,
      [book.bookId],
    );
    await setup.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
  } finally {
    await setup.end();
  }

  const source = await purchaseEvidence(book, 900);

  const owner = await post(
    book,
    "/owner-register/owners",
    {
      sourceKey: key(),
      displayName: "Synthetic batch owner",
      dataNature: "synthetic_example",
      evidenceId: source.id,
      reason: "Synthetic batch owner",
    },
    Owners.Owner,
  );

  const identity = `period_work_${"b".repeat(32)}`;

  const manifest = await post(
    book,
    "/period-work/manifests",
    {
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      cutoff: "2026-12-31",
      children: [
        {
          workIdentity: identity,
          economicIdentity: `owner_expense_${source.id}`,
          sourceRevision: "1",
          sourceSystem: "owner_expense",
          sourceId: source.id,
          documentClass: "owner_expense",
          currency: "SEK",
          sourceMinor: "10000",
          legalSupplierIdentity: local.supplier.id,
          qualifiedTreatmentId: "synthetic_owner_expense",
          evidenceIds: [source.id],
          isPaymentObservation: false,
          existingMatches: [],
          dependsOn: [],
          intendedOwner: "owner.operations",
          prepareInput: {
            mode: "owner_paid_purchase",
            ownerId: owner.id,
            controlAccountId: "account_owner",
            accountingPeriodId: "period_2026",
            postingDate: "2026-09-22",
            series: "A",
            reason: "Privately paid synthetic expense",
            evidence: { paidEvidenceId: source.id, reason: "Retained private payment evidence" },
            purchase: {
              sourceEvidenceId: source.id,
              counterpartyId: local.supplier.id,
              supplierDocumentNumber: "OWNER-BATCH-1",
              documentDate: "2026-09-22",
              taxPoint: { taxPointOn: "2026-09-22", basis: "document_date" },
              lines: [
                {
                  lineId: "expense_line",
                  expenseAccountId: "account_expense",
                  netMinor: "10000",
                  sourceTaxMinor: "0",
                  treatment: {
                    basis: "no_tax_exempt",
                    rate: { numerator: "0", denominator: "1" },
                    deduction: { numerator: "0", denominator: "1" },
                    invoiceTaxRounding: "half_up",
                    deductionRounding: "half_up",
                    acceptancePolicy: "exact_match",
                    toleranceMinor: "0",
                  },
                },
              ],
            },
          },
        },
      ],
      rules: [
        {
          id: "synthetic_owner_rule",
          version: 1,
          legalSupplierIdentity: local.supplier.id,
          supportedDocumentClass: "owner_expense",
          currency: "SEK",
          qualifiedTreatmentId: "synthetic_owner_expense",
          acceptedEvidenceRequirements: [],
          operationFamily: "OwnerPaidPurchase",
          approvedExamples: [],
          negativeExamples: [],
          activationReview: "synthetic_owner_review",
        },
      ],
      populationComplete: false,
      excluded: [],
      acknowledgeNotReconciled: true,
    },
    Domain.PeriodWorkManifest,
  );

  const progress = await post(
    book,
    `/period-work/manifests/${manifest.id}/advance`,
    { boundedCount: 1 },
    PeriodWork.PeriodWorkRunProgress,
  );

  expect(progress.children[0]?.state, JSON.stringify(progress)).toBe("prepared");

  const batch = await post(
    book,
    "/period-work/batches",
    { manifestId: manifest.id, workIdentities: [identity] },
    PeriodWork.ApprovalBatch,
  );

  await post(
    reviewer,
    `/period-work/batches/${batch.id}/approvals`,
    { expectedDigest: batch.digest, acknowledgeSyntheticOnly: true },
    PeriodWork.ApprovalBatch,
  );

  const result = await post(
    book,
    `/period-work/batches/${batch.id}/execute`,
    {
      expectedDigest: batch.digest,
      boundedCount: 1,
      acknowledgeSyntheticOnly: true,
    },
    PeriodWork.PeriodWorkExecutionResult,
  );

  expect(result.refused, JSON.stringify(result)).toEqual([]);
  expect(result.committed).toHaveLength(1);
  const admin = await database();

  try {
    expect(
      (
        await admin.query(
          "select account_id,sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
          [book.bookId],
        )
      ).rows,
    ).toEqual([
      { account_id: "account_expense", debit: "10000", credit: "0" },
      { account_id: "account_owner", debit: "0", credit: "10000" },
    ]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "period-batch-owner-expense.json"),
    JSON.stringify(
      { source: source.id, owner: owner.id, batch, result, expectedCompanyCash: "0" },
      null,
      2,
    ),
  );
});

test("bounded execution freezes each chunk result while later independent members commit", async () => {
  const { book, batch, batchPath } = await preparedBatch();

  await post(
    book,
    `${batchPath}/approvals`,
    { expectedDigest: batch.digest, acknowledgeSyntheticOnly: true },
    PeriodWork.ApprovalBatch,
  );
  const firstKey = key();

  const firstCommand = {
    method: "POST",
    headers: { "idempotency-key": firstKey },
    body: JSON.stringify({
      expectedDigest: batch.digest,
      boundedCount: 1,
      acknowledgeSyntheticOnly: true,
    }),
  };

  const first = await decoded(
    await request(book, `${batchPath}/execute`, firstCommand),
    PeriodWork.PeriodWorkExecutionResult,
  );

  expect(first.committed.map((member) => member.workIdentity)).toEqual([
    batch.members[0]?.workIdentity,
  ]);
  expect(first.nextOrdinal).toBe(1);
  expect(first.counts.committed).toBe(1);

  const second = await post(
    book,
    `${batchPath}/execute`,
    {
      expectedDigest: batch.digest,
      boundedCount: 1,
      afterOrdinal: 1,
      acknowledgeSyntheticOnly: true,
    },
    PeriodWork.PeriodWorkExecutionResult,
  );

  expect(
    second.committed.map((member) => member.workIdentity),
    JSON.stringify(second),
  ).toEqual([batch.members[1]?.workIdentity]);
  expect(second.nextOrdinal).toBeNull();
  expect(second.counts.committed).toBe(2);
  expect(
    await decoded(
      await request(book, `${batchPath}/execute`, firstCommand),
      PeriodWork.PeriodWorkExecutionResult,
    ),
  ).toEqual(first);
  expect(
    await decoded(
      await request(book, `${batchPath}/results/${firstKey}`),
      PeriodWork.PeriodWorkExecutionResult,
    ),
  ).toEqual(first);
  const admin = await database();

  try {
    expect(
      (
        await admin.query("select count(*)::int as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: 2 }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "period-batch-bounded-chunks.json"),
    JSON.stringify({ batch, first, second, expectedVouchers: 2 }, null, 2),
  );
});

test("concurrent exact batch commands converge on retained owner receipts and one result", async () => {
  const { book, batch, batchPath } = await preparedBatch();

  await post(
    book,
    `${batchPath}/approvals`,
    { expectedDigest: batch.digest, acknowledgeSyntheticOnly: true },
    PeriodWork.ApprovalBatch,
  );
  const commandKey = key();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({
      expectedDigest: batch.digest,
      boundedCount: 2,
      acknowledgeSyntheticOnly: true,
    }),
  };

  const responses = await Promise.all([
    request(book, `${batchPath}/execute`, command),
    request(book, `${batchPath}/execute`, command),
  ]);

  const results = await Promise.all(
    responses.map((response) => decoded(response, PeriodWork.PeriodWorkExecutionResult)),
  );

  expect(results[0]).toEqual(results[1]);
  expect(results[0]?.committed).toHaveLength(2);
  expect(results[0]?.refused).toEqual([]);
  const links = [];

  for (const member of batch.members) {
    const view = await decoded(
      await request(book, `/commerce/supplier-acceptance-reviews/${member.ownerReviewId}`),
      Acceptance.SupplierAcceptanceView,
    );

    expect(view.acceptance?.id).toBe(
      results[0]?.committed.find((entry) => entry.workIdentity === member.workIdentity)?.receiptId,
    );
    expect(view.acceptance?.draftId).toBe(view.plan.draftSnapshot.id);
    expect(view.acceptance?.draftDigest).toBe(view.plan.draftSnapshot.digest);
    expect(view.acceptance?.reviewDigest).toBe(view.plan.digest);
    links.push(view);
  }

  const admin = await database();

  try {
    expect(
      (
        await admin.query("select count(*)::int as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: 2 }]);
    expect(
      (
        await admin.query(
          "select count(*)::int as count from openerp.period_work_execution_results where book_id=$1 and command_key=$2",
          [book.bookId, commandKey],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "period-batch-concurrent-owner-links.json"),
    JSON.stringify({ batch, results, links, expectedVouchers: 2, expectedResults: 1 }, null, 2),
  );
});

test.each(["revision", "cancel"] as const)(
  "sealed batch refuses %s changed after approval",
  async (change) => {
    const { book, manifest, batch, batchPath } = await preparedBatch();

    await post(
      book,
      `${batchPath}/approvals`,
      { expectedDigest: batch.digest, acknowledgeSyntheticOnly: true },
      PeriodWork.ApprovalBatch,
    );

    if (change === "revision") {
      const source = manifest.children[0];

      if (!source) throw new Error("The manifest must retain its first source identity.");

      const view = await decoded(
        await request(book, `/commerce/supplier-invoice-drafts/${source.sourceId}`),
        SupplierDrafts.SupplierInvoiceDraftView,
      );

      const draft = view.record;

      await post(
        book,
        `/commerce/supplier-invoice-drafts/${draft.id}/revisions`,
        {
          expectedRevision: draft.revision,
          expectedDigest: draft.digest,
          reason: "Reviewed source text changed after sealed batch approval",
          content: { ...draft.content, title: "Revised retained source after approval" },
        },
        SupplierDrafts.SupplierInvoiceDraftRevision,
      );
    } else {
      await post(
        book,
        `/period-work/manifests/${manifest.id}/cancel`,
        {
          expectedDigest: manifest.digest,
        },
        PeriodWork.PeriodWorkRunProgress,
      );
    }

    const result = await post(
      book,
      `${batchPath}/execute`,
      { expectedDigest: batch.digest, boundedCount: 2, acknowledgeSyntheticOnly: true },
      PeriodWork.PeriodWorkExecutionResult,
    );

    expect(result.committed).toHaveLength(change === "revision" ? 1 : 0);
    expect(result.refused).toHaveLength(change === "revision" ? 1 : 2);
    const admin = await database();

    try {
      expect(
        (
          await admin.query(
            "select count(*)::int as count from openerp.vouchers where book_id=$1",
            [book.bookId],
          )
        ).rows,
      ).toEqual([{ count: change === "revision" ? 1 : 0 }]);
    } finally {
      await admin.end();
    }

    await writeFile(
      join(environment().artifacts, `period-batch-${change}-refusal.json`),
      JSON.stringify({ batch, result, expectedVouchers: change === "revision" ? 1 : 0 }, null, 2),
    );
  },
);

test("batch dispatch links a retained supplier credit to its owning receipt without repeating recognition", async () => {
  const local = await supplierFixture();
  const { book } = local;
  const accepted = await acceptDraft(book, await createDraft(book, local.content));

  const invoice = await decoded(
    await request(book, `/commerce/invoices/${accepted.registerInvoiceId}`),
    Commerce.Invoice,
  );

  const source = await purchaseEvidence(book, 500);
  const identity = `period_work_${"a".repeat(32)}`;

  const manifest = await post(
    book,
    "/period-work/manifests",
    {
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      cutoff: "2026-12-31",
      children: [
        {
          workIdentity: identity,
          economicIdentity: `credit_${source.id}`,
          sourceRevision: "1",
          sourceSystem: "supplier_credit",
          sourceId: source.id,
          documentClass: "domestic_credit_note",
          currency: "SEK",
          legalSupplierIdentity: local.supplier.id,
          qualifiedTreatmentId: "synthetic_credit",
          evidenceIds: [source.id],
          sourceMinor: "6000",
          isPaymentObservation: false,
          existingMatches: [],
          dependsOn: [],
          intendedOwner: "purchases.credits",
          prepareInput: {
            profile: "synthetic-zero-tax-supplier-credit-v1",
            invoiceId: invoice.id,
            acceptanceDigest: accepted.digest,
            expectedInvoiceRevision: invoice.currentRevision.revision,
            expectedAllocationVersion: invoice.allocationVersion,
            expectedOutstandingMinor: "10000",
            creditEvidenceId: source.id,
            supplierCreditNumber: "BATCH-CREDIT",
            amountMinor: "6000",
            creditDate: "2026-09-23",
            accountingPeriodId: "period_2026",
            series: "A",
            reason: "Synthetic batch credit6000",
            acknowledgeSyntheticOnly: true,
          },
        },
      ],
      rules: [
        {
          id: "synthetic_credit_rule",
          version: 1,
          legalSupplierIdentity: local.supplier.id,
          supportedDocumentClass: "domestic_credit_note",
          currency: "SEK",
          qualifiedTreatmentId: "synthetic_credit",
          acceptedEvidenceRequirements: [],
          operationFamily: "SupplierCredit",
          approvedExamples: [],
          negativeExamples: [],
          activationReview: "synthetic_credit_review",
        },
      ],
      populationComplete: false,
      excluded: [],
      acknowledgeNotReconciled: true,
    },
    Domain.PeriodWorkManifest,
  );

  const progress = await post(
    book,
    `/period-work/manifests/${manifest.id}/advance`,
    { boundedCount: 1 },
    PeriodWork.PeriodWorkRunProgress,
  );

  expect(progress.children[0]?.state, JSON.stringify(progress)).toBe("prepared");

  const batch = await post(
    book,
    "/period-work/batches",
    { manifestId: manifest.id, workIdentities: [identity] },
    PeriodWork.ApprovalBatch,
  );

  expect(batch.members[0]?.owner).toBe("purchases.credits");
  await post(
    book,
    `/period-work/batches/${batch.id}/approvals`,
    { expectedDigest: batch.digest, acknowledgeSyntheticOnly: true },
    PeriodWork.ApprovalBatch,
  );
  const commandKey = key();

  const execute = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({
      expectedDigest: batch.digest,
      boundedCount: 1,
      acknowledgeSyntheticOnly: true,
    }),
  };

  const result = await decoded(
    await request(book, `/period-work/batches/${batch.id}/execute`, execute),
    PeriodWork.PeriodWorkExecutionResult,
  );

  expect(result.refused).toEqual([]);
  expect(result.committed).toHaveLength(1);
  expect(
    await decoded(
      await request(book, `/period-work/batches/${batch.id}/execute`, execute),
      PeriodWork.PeriodWorkExecutionResult,
    ),
  ).toEqual(result);

  const refreshed = await decoded(
    await request(book, `/commerce/invoices/${invoice.id}`),
    Commerce.Invoice,
  );

  expect(refreshed.outstandingMinor).toBe("4000");
  const admin = await database();

  try {
    expect(
      (
        await admin.query(
          "select count(*)::int as count,sum(amount_minor)::text as amount from openerp.supplier_credits where book_id=$1 and invoice_id=$2",
          [book.bookId, invoice.id],
        )
      ).rows,
    ).toEqual([{ count: 1, amount: "6000" }]);
    expect(
      (
        await admin.query("select count(*)::int as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: 2 }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "period-batch-credit-owner.json"),
    JSON.stringify(
      { accepted: accepted.id, invoice: invoice.id, batch, result, expectedOutstanding: "4000" },
      null,
      2,
    ),
  );
});
