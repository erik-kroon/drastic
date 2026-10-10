import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as Schema from "effect/Schema";
import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Source from "../../packages/contracts/src/source-intake";
import * as Bank from "../../packages/contracts/src/reconciliation";
import * as Candidates from "../../packages/contracts/src/bank-match-candidates";
import * as Settlement from "../../packages/contracts/src/settlements";
import { signInSyntheticOperator } from "./synthetic-session";

const statements = new Map<string, typeof Bank.StatementImportReceipt.Type>();

export async function bankReviewFixture(
  browser: Browser,
  appUrl: string | undefined,
  mismatched = false,
  original?: { bytes: Buffer; expectedHash: string },
) {
  const workspace = await signInSyntheticOperator(browser, appUrl);

  const origin = new URL(workspace).origin;

  const base = workspace.replace(origin, `${origin}/api/v1`);

  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<S["Type"]> => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    const content = await response.text();

    if (response.status !== 200)
      throw new Error(`Synthetic bank fixture ${path}: HTTP ${response.status}: ${content}`);

    expect(response.status).toBe(200);

    return Schema.decodeSync(Schema.fromJsonString(schema))(content);
  };

  const suffix = randomUUID();

  const bytes =
    original?.bytes ??
    (await readFile(
      new URL("../../verification/testerarmy/bank-review-original.pdf", import.meta.url),
    ));

  const expectedHash =
    original?.expectedHash ??
    "sha256:691883ddc2b2864ee53a2da354405090e878f7eeafbf92a5f101a6d764d9ec36";

  expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(expectedHash);

  const occurrence = await call("/source-occurrences", Source.SourceOccurrence, {
    sourceSystem: "synthetic-bank-review",
    sourceAccountId: "synthetic_originals",
    occurrenceKey: suffix,
    sourceRevision: "1",
    filename: "bank-review-original.pdf",
    mediaType: "application/pdf",
    contentBase64: (mismatched ? Buffer.concat([bytes, Buffer.from("\n")]) : bytes).toString(
      "base64",
    ),
  });

  const evidence = await call("/evidence", Accounting.Evidence, {
    title: "Exempel Kontorsservice AB",
    origin: "Synthetic supplier document and manual journal; no VAT treatment established",
    mediaType: "application/json",
    content: JSON.stringify({
      kind: "supplier_invoice_source_v1",
      source: { occurrenceId: occurrence.id, sha256: expectedHash, filename: occurrence.filename },
      fields: { supplierName: "Exempel Kontorsservice AB", documentNumber: "DEMO-2026-0037" },
    }),
  });

  const vouchers: Array<typeof Accounting.Voucher.Type> = [];

  for (const documentNumber of ["DEMO-2026-0037", "DEMO-2026-0038"]) {
    const plan = await call("/change-sets", Accounting.ChangeSet, {
      kind: "manual_journal",
      evidenceId: evidence.id,
      eventKey: `bank_review_${suffix}_${documentNumber}`,
      accountingPeriodId: "period_synthetic_2026",
      postingDate: documentNumber.endsWith("37") ? "2026-10-03" : "2026-10-02",
      series: "A",
      description: documentNumber,
      rationale:
        "Synthetic matching-capacity control only; not a supplier invoice or VAT assessment",
      taxAssessment: "not_applicable",
      lines: [
        {
          accountId: "account_bank",
          debitMinor: "0",
          creditMinor: "125000",
          description: documentNumber,
        },
        {
          accountId: "account_clearing",
          debitMinor: "125000",
          creditMinor: "0",
          description: "Synthetic counter-line",
        },
      ],
    });

    const approval = await call(`/change-sets/${plan.id}/approvals`, Accounting.Approval, {
      version: plan.version,
      planDigest: plan.planDigest,
    });

    const receipt = await call(`/change-sets/${plan.id}/execute`, Accounting.ExecutionReceipt, {
      version: plan.version,
      planDigest: plan.planDigest,
      approvalId: approval.id,
    });

    const voucher = await call(`/vouchers/${receipt.voucherId}`, Accounting.Voucher);

    vouchers.push(voucher);
  }

  const source = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: "bank_review_demo_2026_0037",
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    openingMinor: "0",
    closingMinor: "-175000",
    completeness: {
      declaredComplete: false,
      basis: "Synthetic outgoing rows; no coverage claim",
    },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-10-03",
        description: "BG EXEMPEL KONTORSSERVICE",
        amountMinor: "-125000",
      },
      {
        rowOrdinal: 2,
        providerId: null,
        date: "2026-10-03",
        description: "SYNTHETIC CONCURRENT PARTIAL PAYMENT",
        amountMinor: "-50000",
      },
    ],
  };

  const statementEvidence = await call("/evidence", Accounting.Evidence, {
    title: "Synthetic outgoing bank row",
    origin: "Synthetic local bank review",
    mediaType: "application/json",
    content: JSON.stringify(source),
  });

  const statement =
    statements.get(base) ??
    (await call("/bank-statements", Bank.StatementImportReceipt, {
      ...source,
      evidenceId: statementEvidence.id,
      existingMatches: [],
    }));

  statements.set(base, statement);

  const candidates = await call("/bank-match-candidates", Candidates.BankMatchCandidates, {
    statementId: statement.statement.id,
    rowOrdinal: 1,
  });

  const candidate = candidates.candidates.find((item) => item.voucherId === vouchers[0]?.id);

  if (!candidate) throw new Error("The real synthetic outgoing bank line must be discoverable");

  expect(candidate.amountMinor).toBe("-125000");
  expect(candidate.remainingMinor).toBe("-125000");
  expect(candidates.identityEstablished).toBe(false);
  expect(candidates.multipleEligibleCandidates).toBe(true);

  const ledger = await call("/ledger", Accounting.LedgerSnapshot);

  const path = `${workspace}/accounts?account=account_bank&from=2026-10-01&to=2026-10-31&statement=${statement.statement.id}&row=1`;

  const consume = async () => {
    const plan = await call("/bank-allocation-plans", Settlement.BankAllocationPlan, {
      accountId: "account_bank",
      reason: "Synthetic concurrent partial match",
      ambiguityAcknowledged: true,
      legs: [
        {
          statementId: statement.statement.id,
          rowOrdinal: 2,
          voucherId: candidate.voucherId,
          lineId: candidate.lineId,
          amountMinor: "-50000",
        },
      ],
    });

    const approval = await call(
      `/bank-allocation-plans/${plan.id}/approve`,
      Settlement.BankAllocationApproval,
      { digest: plan.digest, version: plan.version },
    );

    return call(`/bank-allocation-plans/${plan.id}/execute`, Settlement.BankAllocationExecution, {
      digest: plan.digest,
      version: plan.version,
      approvalId: approval.id,
    });
  };

  return {
    workspace,
    path,
    call,
    occurrence,
    expectedHash,
    evidence,
    vouchers,
    statement,
    candidate,
    candidates,
    ledger,
    consume,
  };
}
