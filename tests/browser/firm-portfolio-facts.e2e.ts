import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Firms from "../../packages/contracts/src/firms";
import * as Company from "../../packages/contracts/src/company-setup";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Deadlines from "../../packages/contracts/src/deadlines";
import * as Bank from "../../packages/contracts/src/reconciliation";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("portfolio retains period and declared deadline while incomplete bank and closing remain explicit", async ({
  app,
  browser,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const seed = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(seed).origin;
  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<S["Type"]> => {
    const response = await fetch(`${origin}/api/v1${path}`, {
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

    if (response.status !== 200)
      throw new Error(`Synthetic ${path} returned ${response.status}: ${await response.text()}`);

    return Schema.decodeUnknownSync(schema)(await response.json());
  };

  const company = await call("/companies", Company.CompanySetup, {
    name: "Synthetic bureau source observations",
  });

  const path = `/entities/${company.scope.entityId}/books/${company.scope.bookId}`;

  const native = await call(`${path}/company-setup/native-ledger`, Company.NativeLedgerSetup, {
    expectedRevision: company.revision,
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    accounts: [{ code: "1930", name: "Synthetic bank account without a source" }],
  });

  const period = native.periods[0];

  if (!period) throw new Error("The independently specified September period must exist");

  expect(native.periods).toHaveLength(1);

  const firm = await call("/firms", Firms.CommandResult, { name: "Synthetic source bureau" });
  const workspace = await call(`/firms/${firm.firmId}`, Firms.Workspace);
  const before = await call(`${path}/ledger`, Accounting.LedgerSnapshot);
  const dueAt = "2026-11-12T12:00:00.000Z";

  const statutoryBasis = {
    jurisdiction: "SE",
    family: "vat",
    ruleReference: "synthetic_portfolio_rule",
    ruleVersion: 1,
    calendarReference: "synthetic_portfolio_calendar",
    periodId: period.id,
    basisDueAt: dueAt,
  };

  const deadlineInput = {
    title: "Synthetic retained VAT deadline",
    periodId: period.id,
    responsibleActorId: workspace.actorId,
    dueAt,
    timeZone: "Europe/Stockholm",
    sourceReference: "Synthetic test declaration, not a reviewed statutory release",
    sourceRevision: "synthetic_v1",
    jurisdiction: "SE",
    statutoryBasis,
    requiredEnvironment: "sandbox",
    outcomeKind: "prepared",
  };

  const deadline = await call(`${path}/deadlines/deadline_portfolio`, Deadlines.Deadline, {
    expectedRevision: null,
    input: deadlineInput,
  });

  await call(`/firms/${firm.firmId}/clients`, Firms.CommandResult, {
    scope: company.scope,
    leadId: workspace.actorId,
    nextReviewOn: "2026-10-01",
    note: "Synthetic source observations only",
    expectedRevision: 0,
  });

  const facts = await call(`/firms/${firm.firmId}/portfolio`, Firms.Portfolio);
  const observed = facts.clients[0];

  if (!observed) throw new Error("The linked client observation must exist");

  expect(facts.clients).toHaveLength(1);
  expect(observed.scope).toEqual(company.scope);
  expect(observed.period).toEqual({ ...period, locked: false });
  expect(observed.openTasks).toBe("0");
  expect(observed.company.details.accountingMethod).toBe(null);
  expect(observed.company.details.organizationNumber).toBe(null);
  expect(observed.deadlines).toEqual([
    {
      ...deadline,
      status: Date.parse(dueAt) < Date.parse(facts.observedFrom) ? "overdue" : "upcoming",
    },
  ]);
  expect(deadline.statutory_basis).toEqual(statutoryBasis);
  expect(new Date(deadline.due_at).toISOString()).toBe(dueAt);
  expect(facts.workspace.clients[0]?.nextReviewOn).toBe("2026-10-01");
  expect(deadline.required_environment).toBe("sandbox");
  expect(deadline.current_outcome).toBe(null);
  expect(observed.bank?.accounts).toEqual([]);
  expect(observed.bankObservations).toEqual([]);
  expect(observed.bankInventorySignoffs).toEqual([]);
  expect(observed.closing?.technicalCloseAllowed).toBe(false);
  expect(observed.closing?.statutoryReady).toBe(false);
  expect(observed.closing?.checks.find((check) => check.code === "SyntheticNativeProfile")).toEqual(
    {
      code: "SyntheticNativeProfile",
      passed: false,
      detail: "Only the native synthetic profile supports this technical lock.",
    },
  );
  expect(observed.closing?.statutoryBlockers.length).toBeGreaterThan(0);

  const revisedDueAt = "2026-11-13T12:00:00.000Z";
  const revisedBasis = { ...statutoryBasis, basisDueAt: revisedDueAt };

  const revised = await call(`${path}/deadlines/deadline_portfolio`, Deadlines.Deadline, {
    expectedRevision: deadline.revision,
    input: {
      ...deadlineInput,
      dueAt: revisedDueAt,
      statutoryBasis: revisedBasis,
      sourceRevision: "synthetic_v2",
      overrideReason: "Synthetic declared source revision correction",
    },
  });

  expect(revised.revision).toBe(deadline.revision + 1);
  expect(revised.statutory_basis).toEqual(revisedBasis);
  expect(new Date(revised.due_at).toISOString()).toBe(revisedDueAt);
  expect(revised.current_outcome).toBe(null);
  const revisedFacts = await call(`/firms/${firm.firmId}/portfolio`, Firms.Portfolio);

  expect(revisedFacts.clients[0]?.deadlines).toEqual([
    {
      ...revised,
      status:
        Date.parse(revisedDueAt) < Date.parse(revisedFacts.observedFrom) ? "overdue" : "upcoming",
    },
  ]);
  const account = native.accounts[0];

  if (!account) throw new Error("The retained synthetic bank account must exist");

  const source = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: randomUUID(),
    sourceBankAccountId: "portfolio_dated_difference",
    accountId: account.id,
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-28",
    openingMinor: "0",
    closingMinor: "10000",
    completeness: { declaredComplete: true, basis: "Synthetic source without a ledger posting" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-09-20",
        description: "Synthetic unmatched receipt",
        amountMinor: "10000",
      },
    ],
  };

  const original = await call(`${path}/evidence`, Accounting.Evidence, {
    title: "Synthetic dated bank difference",
    mediaType: "application/json",
    content: JSON.stringify(source),
    origin: "Synthetic portfolio qualification",
  });

  const imported = await call(`${path}/bank-statements`, Bank.StatementImportReceipt, {
    ...source,
    evidenceId: original.id,
    existingMatches: [],
  });

  const datedFacts = await call(`/firms/${firm.firmId}/portfolio`, Firms.Portfolio);

  expect(datedFacts.clients[0]?.bank?.accounts[0]?.differenceMinor).toBe(null);
  expect(datedFacts.clients[0]?.bankObservations).toHaveLength(1);
  expect(datedFacts.clients[0]?.bankObservations[0]?.endsOn).toBe("2026-09-28");
  expect(datedFacts.clients[0]?.bankObservations[0]?.account.statementId).toBe(
    imported.statement.id,
  );
  expect(datedFacts.clients[0]?.bankObservations[0]?.account.ledgerBalanceMinor).toBe("0");
  expect(datedFacts.clients[0]?.bankObservations[0]?.account.differenceMinor).toBe("10000");
  expect(datedFacts.clients[0]?.bankInventorySignoffs).toEqual([]);

  expect(await call(`${path}/ledger`, Accounting.LedgerSnapshot)).toEqual(before);

  await writeFile(
    join(output, "firm-portfolio-facts.json"),
    JSON.stringify(
      {
        scope:
          "Public HTTP composed portfolio with real native period and retained synthetic deadline",
        limits:
          "No V1 browser/parity, bank signing, successful closing, statutory rule certification or company-setup acceptance. Native ledger and obligation are synthetic fixture preparation; company facts remain unknown.",
        native,
        deadline,
        revised,
        facts,
        revisedFacts,
        imported,
        datedFacts,
        before,
      },
      null,
      2,
    ),
  );
});
