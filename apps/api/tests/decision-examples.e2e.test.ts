import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as A from "@open-erp/contracts/accounting";
import * as E from "@open-erp/contracts/decision-examples";
import { supplierFixture, createDraft, acceptDraft } from "./support/supplier-review";
import {
  database,
  createSession,
  decoded,
  environment,
  execute,
  evidence,
  failure,
  key,
  journal,
  post,
  request,
  run,
} from "./support/fixtures";

const path = "/automation/decision-examples";

test("sealed decision examples preserve captured state, redact text, count reversal and replay exact revisions", async () => {
  const f = await supplierFixture();
  f.book.token = (await createSession(f.book)).token;
  const text = "Synthetic invoice personal number 19900101-1234; amount 10000";

  const source = await post(
    f.book,
    "/evidence",
    { title: "Document", mediaType: "text/plain", origin: "Synthetic AUT02", content: text },
    A.Evidence,
  );

  const draft = await createDraft(f.book, { ...f.content, sourceEvidenceId: source.id });
  const accepted = await acceptDraft(f.book, draft);
  const manualSource = await evidence(f.book);

  const second = await execute(
    f.book,
    await post(f.book, "/change-sets", journal(manualSource.id, "10000"), A.ChangeSet),
  );

  const voucher = await decoded(await request(f.book, `/vouchers/${second.voucherId}`), A.Voucher);
  const B = await import("@open-erp/contracts/reconciliation");

  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: "20000",
    completeness: { declaredComplete: false, basis: "Synthetic AUT02" },
    rows: [
      {
        rowOrdinal: 2,
        providerId: null,
        date: "2026-09-22",
        description: "Synthetic second row",
        amountMinor: "10000",
      },
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-09-22",
        description: "Synthetic 19900101-1234",
        amountMinor: "10000",
      },
    ],
  };

  const bankSource = await post(
    f.book,
    "/evidence",
    {
      title: "Statement",
      content: JSON.stringify(statement),
      mediaType: "application/json",
      origin: "Synthetic AUT02",
    },
    A.Evidence,
  );

  const imported = await post(
    f.book,
    "/bank-statements",
    { ...statement, evidenceId: bankSource.id, existingMatches: [] },
    B.StatementImportReceipt,
  );

  await post(
    f.book,
    "/bank-matches",
    {
      statementId: imported.statement.id,
      rowOrdinal: 2,
      voucherId: second.voucherId,
      lineId: voucher.action.lines[0]!.lineId,
    },
    B.BankMatchReceipt,
  );

  const supplierVoucher = await decoded(
    await request(f.book, `/vouchers/${accepted.postingReceipt.voucherId}`),
    A.Voucher,
  );

  await post(
    f.book,
    "/bank-matches",
    {
      statementId: imported.statement.id,
      rowOrdinal: 1,
      voucherId: accepted.postingReceipt.voucherId,
      lineId: supplierVoucher.action.lines[0]!.lineId,
    },
    B.BankMatchReceipt,
  );
  const input = { purpose: "training" as const, selectedDecisionIds: [] };
  const retryKey = key();

  const seal = () =>
    request(f.book, path, {
      method: "POST",
      headers: { "idempotency-key": retryKey },
      body: JSON.stringify(input),
    });

  const initial = await decoded(await seal(), E.DecisionExampleExport);
  expect(initial.examples).toHaveLength(3);
  expect(initial.examples.find((row) => row.decision.owner === "bank_match")?.state).toMatchObject({
    amountMinor: "10000",
    description: "Synthetic [REDACTED_PERSONAL_ID]",
    observedOn: "2026-09-22",
  });

  const observed = initial.examples.find((row) => row.decision.id === accepted.approvalId);
  expect(observed).toMatchObject({
    originalCommitCutoff: "0",
    provenance: { classification: "independent" },
    state: { draftRevision: draft.revision, sourceTotalMinor: "10000", documentDate: "2026-09-22" },
    chosenTreatment: {
      journal: {
        lines: [
          { accountId: "account_bank", debitMinor: "10000", creditMinor: "0" },
          { accountId: "account_clearing", debitMinor: "0", creditMinor: "10000" },
        ],
      },
    },
  });
  expect(observed?.evidence[0]?.transcript).toBe(
    "Synthetic invoice personal number [REDACTED_PERSONAL_ID]; amount 10000",
  );
  const admin = await database();

  try {
    await admin.query(
      "update openerp.accounts set name='LATER_FACT_CANARY' where book_id=$1 and id='account_bank'",
      [f.book.bookId],
    );
  } finally {
    await admin.end();
  }

  expect(initial.examples[0]?.options.capture).toBe("no_recorded_exposure");
  expect(JSON.stringify(initial)).not.toContain("19900101-1234");
  expect(JSON.stringify(initial)).toContain("[REDACTED_PERSONAL_ID]");
  expect(JSON.stringify(initial)).toContain("10000");
  await post(
    f.book,
    "/evidence",
    {
      title: "LATER_FACT_CANARY",
      content: "LATER_FACT_CANARY",
      origin: "Synthetic later fact",
      mediaType: "text/plain",
    },
    A.Evidence,
  );
  expect(await decoded(await seal(), E.DecisionExampleExport)).toEqual(initial);
  expect(
    await decoded(await request(f.book, `${path}/${initial.id}`), E.DecisionExampleExport),
  ).toEqual(initial);

  expect(new Set(initial.manifest.lineageInventory.map((item) => item.id)).size).toBe(
    initial.manifest.lineageInventory.length,
  );
  const Reversals = await import("@open-erp/contracts/bank-match-reversals");

  const undo = await post(
    f.book,
    "/bank-match-reversal-plans",
    {
      target: { kind: "exact_match", statementId: imported.statement.id, rowOrdinal: 2 },
      reason: "Synthetic explicit withdrawal",
    },
    Reversals.BankMatchReversalPlan,
  );

  const undoApproval = await post(
    f.book,
    `/bank-match-reversal-plans/${undo.id}/approve`,
    { version: 1, digest: undo.digest },
    Reversals.BankMatchReversalApproval,
  );

  const undone = await post(
    f.book,
    `/bank-match-reversal-plans/${undo.id}/execute`,
    { version: 1, digest: undo.digest, approvalId: undoApproval.id },
    Reversals.BankMatchReversalExecution,
  );

  const withdrawn = await post(f.book, path, input, E.DecisionExampleExport);
  expect(withdrawn.examples).toHaveLength(2);
  expect(withdrawn.exclusions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: `${imported.statement.id}:2`, reason: "bank_match_reversed" }),
    ]),
  );
  expect(withdrawn.manifest.lineageInventory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "bank_match_reversal", id: undone.planId }),
    ]),
  );

  const correction = await post(
    f.book,
    `/vouchers/${second.voucherId}/correction-proposals`,
    {
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-23",
      rationale: "Synthetic reversal",
    },
    A.ChangeSet,
  );

  await execute(f.book, correction);
  const next = await post(f.book, path, input, E.DecisionExampleExport);
  expect(next.examples).toHaveLength(2);
  expect(next.examples.find((row) => row.decision.id === accepted.approvalId)?.digest).toBe(
    initial.examples.find((row) => row.decision.id === accepted.approvalId)?.digest,
  );
  expect(next.exclusions).toEqual(
    expect.arrayContaining([expect.objectContaining({ reason: "reversed_without_replacement" })]),
  );
  expect(next.manifest.denominators.inventory).toBe(3);
  expect(next.manifest.denominators.exported).toBe(2);
  expect(JSON.stringify(next)).not.toContain("LATER_FACT_CANARY");

  const outputs = [
    join(environment().artifacts, "examples-one"),
    join(environment().artifacts, "examples-two"),
  ];

  for (const directory of outputs) {
    await mkdir(directory);
    await run(
      "node",
      [
        "verification/decision-examples/export.mjs",
        f.book.entityId,
        f.book.bookId,
        initial.id,
        directory,
      ],
      {
        cwd: new URL("../../..", import.meta.url).pathname,
        env: {
          ...process.env,
          OPENERP_API_URL: `${environment().baseUrl}/api`,
          OPENERP_OPERATOR_TOKEN: f.book.token,
        },
      },
    );
  }

  expect(await readFile(join(outputs[0]!, "examples.jsonl"), "utf8")).toBe(
    await readFile(join(outputs[1]!, "examples.jsonl"), "utf8"),
  );
  expect(await readFile(join(outputs[0]!, "manifest.json"), "utf8")).toBe(
    await readFile(join(outputs[1]!, "manifest.json"), "utf8"),
  );

  await failure(
    await request({ ...f.book, token: f.book.agentToken }, path, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify(input),
    }),
    403,
    "Forbidden",
  );
  await writeFile(
    join(environment().artifacts, "decision-examples-sealed.json"),
    JSON.stringify({ initial, withdrawn, next }, null, 2),
  );
});

test("evaluation explicitly refuses suggestion-influenced decisions and counts inventory exclusions", async () => {
  const f = await supplierFixture();
  f.book.token = (await createSession(f.book)).token;
  await acceptDraft(f.book, await createDraft(f.book, f.content));
  const B = await import("@open-erp/contracts/reconciliation");
  const C = await import("@open-erp/contracts/bank-match-candidates");

  const statement = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: "10000",
    completeness: { declaredComplete: false, basis: "Synthetic AUT02" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-09-22",
        description: "Synthetic",
        amountMinor: "10000",
      },
    ],
  };

  const source = await post(
    f.book,
    "/evidence",
    {
      title: "Statement",
      content: JSON.stringify(statement),
      mediaType: "application/json",
      origin: "Synthetic AUT02",
    },
    A.Evidence,
  );

  const imported = await post(
    f.book,
    "/bank-statements",
    { ...statement, evidenceId: source.id, existingMatches: [] },
    B.StatementImportReceipt,
  );

  const ranked = await post(
    f.book,
    "/bank-match-candidates",
    { statementId: imported.statement.id, rowOrdinal: 1 },
    C.BankMatchCandidates,
  );

  const candidate = ranked.candidates[0];

  if (!candidate) throw new Error("A synthetic exact bank candidate is required.");
  await post(
    f.book,
    "/bank-matches",
    {
      statementId: imported.statement.id,
      rowOrdinal: 1,
      voucherId: candidate.voucherId,
      lineId: candidate.lineId,
      presentedSuggestionIds: [ranked.suggestionRecordId],
    },
    B.BankMatchReceipt,
  );
  const decisionId = `${imported.statement.id}:1`;
  await failure(
    await request(f.book, path, {
      method: "POST",
      headers: { "idempotency-key": key() },
      body: JSON.stringify({ purpose: "evaluation", selectedDecisionIds: [decisionId] }),
    }),
    422,
    "UnsupportedProfile",
  );

  const exported = await post(
    f.book,
    path,
    { purpose: "evaluation", selectedDecisionIds: [] },
    E.DecisionExampleExport,
  );

  expect(exported.exclusions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: decisionId, reason: "evaluation_ineligible" }),
    ]),
  );
  expect(
    exported.examples.every((row) =>
      ["independent", "corrected"].includes(row.provenance.classification),
    ),
  ).toBe(true);
  await writeFile(
    join(environment().artifacts, "decision-examples-evaluation.json"),
    JSON.stringify(exported, null, 2),
  );
});

test("committed correction relabels only the journal and pins immutable replacement lineage", async () => {
  const f = await supplierFixture([
    { id: "account_replacement", code: "4010", name: "Synthetic replacement" },
    { id: "account_expense", code: "6550", name: "Original expense" },
  ]);

  f.book.token = (await createSession(f.book)).token;

  const accepted = await acceptDraft(
    f.book,
    await createDraft(f.book, f.content),
    "account_expense",
  );

  const Corrections = await import("@open-erp/contracts/corrections");

  const original = await post(
    f.book,
    path,
    { purpose: "training", selectedDecisionIds: [] },
    E.DecisionExampleExport,
  );

  const voucher = await decoded(
    await request(f.book, `/vouchers/${accepted.postingReceipt.voucherId}`),
    A.Voucher,
  );

  const intent = {
    datePolicy: "explicit_open_period" as const,
    accountingPeriodId: "period_2026",
    postingDate: "2026-09-23",
    rationale: "Synthetic relabel",
    replacement: {
      description: "Replacement",
      lines: voucher.action.lines.map((line) => ({
        accountId: line.accountId === "account_expense" ? "account_replacement" : line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
        originalDimensions: line.originalDimensions ?? [],
      })),
    },
  };

  const impact = await post(
    f.book,
    `/vouchers/${accepted.postingReceipt.voucherId}/correction-impact-reviews`,
    intent,
    Corrections.CorrectionImpact,
  );

  const bundle = await post(
    f.book,
    `/vouchers/${accepted.postingReceipt.voucherId}/correction-bundles`,
    { ...intent, impactReview: { id: impact.id, digest: impact.digest } },
    Corrections.CorrectionBundle,
  );

  const approval = await post(
    f.book,
    `/correction-bundles/${bundle.id}/approvals`,
    { version: 1, bundleDigest: bundle.bundleDigest },
    Corrections.CorrectionBundleApproval,
  );

  const receipt = await post(
    f.book,
    `/correction-bundles/${bundle.id}/execute`,
    { version: 1, bundleDigest: bundle.bundleDigest, approvalId: approval.id },
    Corrections.CorrectionBundleReceipt,
  );

  const changed = await post(
    f.book,
    path,
    { purpose: "training", selectedDecisionIds: [] },
    E.DecisionExampleExport,
  );

  expect(changed.examples).toHaveLength(1);
  expect(changed.examples[0]?.state).toEqual(original.examples[0]?.state);
  expect(changed.examples[0]?.chosenTreatment).toMatchObject({
    journal: { lines: [{ debitMinor: "10000" }, { creditMinor: "10000" }] },
    vatReasoning: "replacement_journal_only",
  });
  expect(changed.examples[0]?.lineage).toHaveLength(1);
  expect(changed.examples[0]?.missingFacts).toContain("replacement_vat_reasoning_not_captured");
  expect(changed.examples[0]?.digest).not.toBe(original.examples[0]?.digest);
  await writeFile(
    join(environment().artifacts, "decision-examples-correction.json"),
    JSON.stringify({ original, changed, receipt }, null, 2),
  );
});
