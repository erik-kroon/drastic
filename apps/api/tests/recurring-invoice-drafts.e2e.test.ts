/// <reference types="bun" />
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { captureWorkInventory } from "../scripts/operations/durable-work";
import { tableFingerprints } from "../scripts/operations/snapshot";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Catalog from "@open-erp/contracts/catalog";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Recurring from "@open-erp/contracts/recurring-invoices";
import * as Workspace from "@open-erp/contracts/workspace";
import { withWorkspaceBrowser } from "./support/workspace-browser";
import { legalFixture } from "./support/legal-commerce";
import {
  apiDirectory,
  database,
  decoded,
  environment,
  failure,
  fixture,
  post,
  request,
} from "./support/fixtures";

const Scheduling = Schema.Struct({
  scope: Accounting.Scope,
  agreementId: Accounting.Identifier,
  enabled: Schema.Boolean,
  generation: Schema.String,
  firstAutomaticCycle: Schema.String,
  nextCycleOrdinal: Schema.String,
  nextCycleDate: Accounting.AccountingDate,
  requestedBy: Accounting.Identifier,
  timeZone: Schema.String,
  duePolicy: Schema.Literal("local_calendar_date_v1"),
  history: Schema.Array(
    Schema.Struct({
      cycleOrdinal: Schema.String,
      generation: Schema.String,
      state: Schema.String,
      reason: Schema.NullOr(Schema.String),
      draftId: Schema.NullOr(Schema.String),
    }),
  ),
});

const DraftInventoryPage = Schema.Struct({
  scope: Accounting.Scope,
  complete: Schema.Boolean,
  count: Schema.Int,
  continuation: Schema.NullOr(Accounting.Identifier),
  items: Schema.Array(Drafts.InvoiceDraftSummary).check(Schema.isMaxLength(200)),
});

const AgreementPage = Schema.Struct({
  scope: Accounting.Scope,
  continuation: Schema.NullOr(Schema.String),
  items: Schema.Array(Recurring.RecurringAgreement),
});

type Context = Awaited<ReturnType<typeof legalFixture>>;

function commercialTemplate(
  context: Context,
): typeof Recurring.CommercialRecurringTemplateInput.Type {
  const content = context.original.draftSnapshot.content;

  return {
    kind: "commercial",
    title: "P08 synthetic recurring service",
    counterpartyId: content.counterpartyId,
    seller: content.seller,
    currency: "SEK",
    currencyScale: 2,
    paymentTerms: "14 calendar days",
    dateOffsets: { issueDays: "0", supplyDays: "0", dueDays: "14" },
    lines: [
      {
        id: "recurring_service",
        description: "Synthetic recurring service",
        quantity: "3",
        unitPriceMinor: "1001",
        discountMinor: "2",
        chargeMinor: "4",
        treatment: {
          kind: "legal_sales_policy",
          id: context.original.policyId,
          digest: context.original.policyDigest,
        },
      },
    ],
  };
}

async function agreement(
  context: Context,
  title: string,
  anchor = "2026-01-31",
  templateInput: typeof Recurring.CommercialRecurringTemplateInput.Type = commercialTemplate(
    context,
  ),
) {
  const record = await post(
    context.author,
    "/commerce/recurring-invoices",
    {
      customerId: context.customer.id,
      title,
      schedule: {
        anchorLocalDate: anchor,
        timeZone: "Europe/Stockholm",
        cadence: {
          kind: "monthly",
          monthInterval: "1",
          dayInterval: null,
          monthAnchorPolicy: "anchor_day_clamped",
        },
        firstCycleOrdinal: "1",
      },
      reason: "P08 synthetic calendar agreement",
    },
    Recurring.RecurringAgreement,
  );

  const input = {
    expectedAgreementRevision: record.revision,
    expectedAgreementDigest: record.digest,
    effectiveFromCycle: "1",
    chargeComponentKeys: ["service"],
    template: templateInput,
    reason: "P08 retained commercial input",
  };

  const template = await post(
    context.author,
    `/commerce/recurring-invoices/${record.id}/template-revisions`,
    input,
    Recurring.RecurringTemplateRevision,
  );

  return { record, template, input, path: `/commerce/recurring-invoices/${record.id}` };
}

async function state(context: Context, path: string) {
  return decoded(await request(context.author, `${path}/scheduling`), Scheduling);
}

async function enroll(context: Context, path: string, firstAutomaticCycle: string) {
  return post(
    context.author,
    `${path}/scheduling`,
    {
      expectedGeneration: "0",
      enabled: true,
      firstAutomaticCycle,
      duePolicy: "local_calendar_date_v1",
      confirmFirstAutomaticCycle: true,
      reason: "P08 operator confirms automatic start",
    },
    Scheduling,
  );
}

function runner(context: Context) {
  const child = spawn("bun", ["scripts/preparation-runner.ts"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: environment().runtimeUrl,
      OPENERP_PREPARATION_TOKEN: context.book.token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";

  child.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });

  return { child, log: () => log };
}

async function stop(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");

  const deadline = setTimeout(() => {
    child.kill("SIGKILL");
  }, 5000);

  child.kill("SIGTERM");

  try {
    await exited;
  } finally {
    clearTimeout(deadline);
  }
}

async function waitFor(
  context: Context,
  path: string,
  accept: (value: typeof Scheduling.Type) => boolean,
) {
  const deadline = Date.now() + 45000;
  let value = await state(context, path);

  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    value = await state(context, path);
  }

  expect(accept(value), JSON.stringify(value)).toBe(true);

  return value;
}

async function event(
  context: Context,
  recurring: Awaited<ReturnType<typeof agreement>>,
  kind: "pause" | "resume" | "end",
  cycle: string,
) {
  return post(
    context.author,
    `${recurring.path}/events`,
    {
      expectedAgreementRevision: recurring.record.revision,
      expectedAgreementDigest: recurring.record.digest,
      kind,
      effectiveCycle: cycle,
      reason: `P08 explicit ${kind}`,
    },
    Recurring.RecurringAgreementEvent,
  );
}

test("confirmed commercial schedules create exact ordinary drafts through the durable Bun queue and expose gaps", async () => {
  const context = await legalFixture();
  const recurring = await agreement(context, "P08 exact calendar schedule");

  const invalid = {
    ...recurring.input,
    template: { ...commercialTemplate(context), baseMinor: "9999" },
  };

  await failure(
    await request(context.author, `${recurring.path}/template-revisions`, {
      method: "POST",
      body: JSON.stringify(invalid),
    }),
    400,
    "InvalidRequest",
  );
  await failure(
    await request(context.author, `${recurring.path}/scheduling`, {
      method: "POST",
      body: JSON.stringify({
        expectedGeneration: "0",
        enabled: true,
        firstAutomaticCycle: "1",
        duePolicy: "local_calendar_date_v1",
        confirmFirstAutomaticCycle: false,
        reason: "Not confirmed",
      }),
    }),
    400,
    "InvalidRequest",
  );

  const excessInputs = [
    {
      path: `${recurring.path}/scheduling`,
      input: {
        expectedGeneration: "0",
        enabled: true,
        firstAutomaticCycle: "1",
        duePolicy: "local_calendar_date_v1",
        confirmFirstAutomaticCycle: true,
        reason: "Unknown scheduling amount refuses",
        sourceTotalMinor: "9999",
      },
    },
    {
      path: `${recurring.path}/scheduling/catch-up`,
      input: {
        expectedGeneration: "1",
        cycleOrdinals: ["1"],
        confirmCatchUp: true,
        reason: "Unknown catch-up receipt refuses",
        draftId: "invented_draft",
      },
    },
    {
      path: `${recurring.path}/template-revisions`,
      input: {
        ...recurring.input,
        template: {
          ...commercialTemplate(context),
          lines: commercialTemplate(context).lines.map((line) => ({
            ...line,
            lineNetMinor: "9999",
          })),
        },
      },
    },
  ];

  for (const excess of excessInputs) {
    await failure(
      await request(context.author, excess.path, {
        method: "POST",
        body: JSON.stringify(excess.input),
      }),
      400,
      "InvalidRequest",
    );
  }

  const enrollment = await enroll(context, recurring.path, "1");
  expect(enrollment).toMatchObject({
    firstAutomaticCycle: "1",
    nextCycleOrdinal: "1",
    nextCycleDate: "2026-02-28",
    requestedBy: context.author.actorId,
  });

  const admin = await database();
  await admin.query(
    "UPDATE openerp_auth.session SET expires_at = now() - interval '1 second' WHERE token = $1",
    [context.author.token],
  );
  const observer = { ...context, author: { ...context.author, token: context.book.token } };
  const first = runner(context);
  const second = runner(context);
  let finished: typeof Scheduling.Type;

  try {
    finished = await waitFor(observer, recurring.path, (value) =>
      value.history.some((item) => item.cycleOrdinal === "2" && item.state === "drafted"),
    );
  } finally {
    await stop(first.child);
    await stop(second.child);
    await writeFile(
      join(environment().artifacts, "recurring-runners.log"),
      first.log() + second.log(),
    );
  }

  const history = finished.history.filter((item) => ["1", "2"].includes(item.cycleOrdinal));
  expect(history.map((item) => item.state)).toEqual(["drafted", "drafted"]);

  const occurrences = await decoded(
    await request(observer.author, `${recurring.path}/occurrences`),
    Recurring.RecurringOccurrenceList,
  );

  expect(occurrences.items.find((item) => item.cycleOrdinal === "1")?.cycleDate).toBe("2026-02-28");
  expect(occurrences.items.find((item) => item.cycleOrdinal === "2")?.cycleDate).toBe("2026-03-31");
  expect(occurrences.items.some((item) => item.cycleOrdinal === "0")).toBe(false);
  const draftId = history[0]?.draftId;
  expect(typeof draftId).toBe("string");

  const draft = await decoded(
    await request(observer.author, `/commerce/invoice-drafts/${draftId}`),
    Drafts.InvoiceDraftView,
  );

  expect(draft.record).toMatchObject({
    purpose: "commercial",
    occurrence: { agreementId: recurring.record.id, cycleOrdinal: "1" },
    totals: {
      baseMinor: "3003",
      discountMinor: "2",
      chargeMinor: "4",
      netMinor: "3005",
      taxMinor: "751",
      grossMinor: "3756",
    },
    content: { plannedIssueDate: "2026-02-28", dueDate: "2026-03-14" },
  });

  const counts = await admin.query<{ occurrences: number; drafts: number; issues: number }>(
    `SELECT (SELECT count(*)::int FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2) AS occurrences,
    (SELECT count(DISTINCT draft_id)::int FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2) AS drafts,
    (SELECT count(*)::int FROM openerp.recurring_invoice_occurrence_issues WHERE book_id=$1 AND agreement_id=$2) AS issues`,
    [context.book.bookId, recurring.record.id],
  );

  expect(counts.rows[0]?.drafts).toBe(counts.rows[0]?.occurrences);
  expect(counts.rows[0]?.issues).toBe(0);
  await admin.end();
  await writeFile(
    join(environment().artifacts, "recurring-exact-journey.json"),
    JSON.stringify({ enrollment, finished, occurrences, draft }, null, 2),
  );
});

test("paused cycles and manual future occupancy remain explicit without catch-up on resume", async () => {
  const context = await legalFixture();
  const recurring = await agreement(context, "P08 skipped holes");
  await post(
    context.author,
    `${recurring.path}/occurrences`,
    { cycleOrdinal: "5", reason: "Explicit manual future selection" },
    Recurring.RecurringOccurrence,
  );
  await event(context, recurring, "pause", "1");
  await event(context, recurring, "resume", "4");
  await enroll(context, recurring.path, "1");
  const process = runner(context);
  let finished: typeof Scheduling.Type;

  try {
    finished = await waitFor(context, recurring.path, (value) =>
      value.history.some((item) => item.cycleOrdinal === "5" && item.state === "existing") &&
      value.history.some((item) => item.cycleOrdinal === "4" && item.state === "drafted"),
    );
  } finally {
    await stop(process.child);
  }

  expect(
    finished.history
      .filter((item) => ["1", "2", "3"].includes(item.cycleOrdinal))
      .map((item) => [item.cycleOrdinal, item.state]),
  ).toEqual([
    ["1", "skipped"],
    ["2", "skipped"],
    ["3", "skipped"],
  ]);
  expect(finished.history.find((item) => item.cycleOrdinal === "4")?.state).toBe("drafted");
  await failure(
    await request(context.author, `${recurring.path}/scheduling/catch-up`, {
      method: "POST",
      body: JSON.stringify({
        expectedGeneration: finished.generation,
        cycleOrdinals: ["1"],
        confirmCatchUp: false,
        reason: "Unconfirmed backlog",
      }),
    }),
    400,
    "InvalidRequest",
  );
  await post(
    context.author,
    `${recurring.path}/scheduling/catch-up`,
    {
      expectedGeneration: finished.generation,
      cycleOrdinals: ["1"],
      confirmCatchUp: true,
      reason: "Explicitly review only the first missed cycle",
    },
    Scheduling,
  );
  const recoveryRunner = runner(context);
  let recovered: typeof Scheduling.Type;

  try {
    recovered = await waitFor(context, recurring.path, (value) =>
      value.history.some((item) => item.cycleOrdinal === "1" && item.state === "drafted"),
    );
  } finally {
    await stop(recoveryRunner.child);
  }

  expect(
    recovered.history.filter((item) => item.cycleOrdinal === "2").map((item) => item.state),
  ).toEqual(["skipped"]);

  const recoveredId = recovered.history.find(
    (item) => item.cycleOrdinal === "1" && item.state === "drafted",
  )?.draftId;

  const saved = (
    await decoded(
      await request(context.author, `/commerce/invoice-drafts/${recoveredId}`),
      Drafts.InvoiceDraftView,
    )
  ).record;

  if (saved.purpose !== "commercial")
    throw new Error("Catch-up must produce an ordinary commercial draft.");

  const revised = await post(
    context.author,
    `/commerce/invoice-drafts/${saved.id}/revisions`,
    {
      expectedRevision: saved.revision,
      expectedDigest: saved.digest,
      reason: "Human review resolves current issue identity",
      commercial: {
        ...saved.commercialInput,
        customer: context.original.draftSnapshot.content.customer,
        plannedIssueDate: context.today,
        supplyDate: context.today,
        dueDate: context.today,
      },
    },
    Drafts.InvoiceDraftRevision,
  );

  const issueInput = {
    profile: "se-domestic-b2b-sek-25-accrual-v1",
    draftId: revised.id,
    expectedRevision: revised.revision,
    expectedDigest: revised.digest,
    policyId: context.original.policyId,
    policyDigest: context.original.policyDigest,
    accountingProfileId: context.profile.id,
    accountingProfileDigest: context.profile.digest,
    controlAccountId: "account_ar",
    revenueAccountId: "account_revenue",
    outputVatAccountId: "account_vat",
    accountingPeriodId: "period_2026",
    voucherSeries: "A",
    reason: "Review the selected catch-up occurrence",
    acknowledgeLimitedProfile: true,
  };

  const issueReview = await post(
    context.author,
    "/commerce/ar-legal-issue-reviews",
    issueInput,
    Ar.ArLegalIssueReview,
  );

  expect(issueReview.totals).toEqual({ netMinor: "3005", taxMinor: "751", grossMinor: "3756" });
  await event(context, recurring, "pause", "6");
  await failure(
    await request(context.author, "/commerce/ar-legal-issue-reviews", {
      method: "POST",
      body: JSON.stringify(issueInput),
    }),
    409,
    "StaleDependency",
  );
  await writeFile(
    join(environment().artifacts, "recurring-gaps.json"),
    JSON.stringify({ finished, recovered, issueReview }, null, 2),
  );
});

test("full lifecycle witness fences admitted jobs and revocation remains visible", async () => {
  const initial = await legalFixture();
  const context = { ...initial, author: initial.reviewer };
  const recurring = await agreement(context, "P08 authority and event fence");
  const paused = await agreement(context, "P08 paused authority creates no competing queue");

  await event(context, paused, "pause", "1");
  await enroll(context, paused.path, "1");
  await enroll(context, recurring.path, "1");
  const admin = await database();
  await admin.query("DELETE FROM openerp.memberships WHERE book_id = $1 AND actor_id = $2", [
    context.book.bookId,
    context.author.actorId,
  ]);
  const observer = { ...context, author: initial.author };
  const process = runner(context);

  try {
    const stopped = await waitFor(observer, recurring.path, (value) =>
      value.history.some((item) => item.state === "failed"),
    );

    expect(stopped.history.find((item) => item.state === "failed")?.reason).toBe("Forbidden");

    const attention = await decoded(
      await request(observer.author, "/attention?kind=recurring&status=open"),
      Workspace.AttentionPage,
    );

    const pausedState = await waitFor(observer, paused.path, (value) =>
      value.history.some((job) => job.state === "skipped"),
    );

    expect(pausedState.history.every((job) => job.state === "skipped")).toBe(true);
    expect(attention.items.every((item) => item.recurringAgreementId !== paused.record.id)).toBe(
      true,
    );
    const failedJob = stopped.history.find((item) => item.state === "failed");
    expect(attention.items[0]).toMatchObject({
      kind: "recurring",
      reason: "recurring_draft_failed",
      recurringAgreementId: recurring.record.id,
    });
    expect(failedJob?.draftId).toBe(null);
    const attentionItem = attention.items.find((item) => item.id === failedJob?.id);

    if (attentionItem === undefined) throw new Error("Missing recurring failure attention item");

    const focused = await decoded(
      await request(observer.author, `${recurring.path}/scheduling?job=${attentionItem.id}`),
      Schema.Struct({
        selectedJob: Schema.NullOr(
          Schema.Struct({
            id: Schema.String,
            cycleOrdinal: Schema.String,
            cycleDate: Accounting.AccountingDate,
          }),
        ),
      }),
    );

    expect(focused.selectedJob).toMatchObject({
      id: attentionItem.id,
      cycleOrdinal: "1",
      cycleDate: "2026-02-28",
    });
    const other = await agreement(observer, "P08 scoped recovery substitution");

    await enroll(observer, other.path, "1");
    await failure(
      await request(observer.author, `${other.path}/scheduling?job=${attentionItem.id}`),
      404,
      "NotFound",
    );
    const browserActor = await fixture();

    await admin.query(
      "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
      [initial.book.bookId, browserActor.actorId],
    );
    await withWorkspaceBrowser(
      { ...initial.book, actorId: browserActor.actorId },
      "recurring-recovery",
      async (page, workspace) => {
        await page.goto(`${workspace}/work?kind=recurring&status=open`);
        await page.getByRole("link", { name: recurring.record.title, exact: true }).first().click();
        await page.getByRole("heading", { name: recurring.record.title, exact: true }).waitFor();
        expect(page.url()).toContain(`record=${recurring.record.id}`);
        await page.setViewportSize({ width: 320, height: 900 });
        await page
          .getByRole("checkbox", { name: "Confirm the selected cycle", exact: true })
          .check();
        await page
          .getByRole("button", { name: "Queue selected cycle for review", exact: true })
          .focus();
        await page.screenshot({
          path: join(environment().artifacts, "recurring-recovery-320.png"),
          fullPage: true,
        });
      },
    );

    const rows = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, recurring.record.id],
    );

    expect(rows.rows[0]?.count).toBe(0);
    await writeFile(
      join(environment().artifacts, "recurring-authority.json"),
      JSON.stringify(stopped, null, 2),
    );
  } finally {
    await stop(process.child);
    await admin.end();
  }
}, 120000);

test("unknown commit recovery and pruned queue history retain one economic occurrence", async () => {
  const context = await legalFixture();
  const recurring = await agreement(context, "P08 restart recovery");
  const enrollment = await enroll(context, recurring.path, "1");
  const first = runner(context);
  let committed: typeof Scheduling.Type;

  try {
    committed = await waitFor(context, recurring.path, (value) =>
      value.history.some((item) => item.cycleOrdinal === "1" && item.state === "drafted"),
    );
  } finally {
    await stop(first.child);
  }

  const admin = await database();
  const before = committed.history.find((item) => item.cycleOrdinal === "1")?.draftId;
  await admin.query(
    "DELETE FROM public.effect_mq_jobs WHERE name = 'recurring-invoice-draft' AND metadata ->> 'bookId' = $1",
    [context.book.bookId],
  );
  await admin.query(
    "UPDATE openerp.recurring_invoice_draft_jobs SET state='ready', draft_id=null, settled_at=null, dispatched_at=null WHERE book_id=$1 AND agreement_id=$2 AND cycle_ordinal=1",
    [context.book.bookId, recurring.record.id],
  );
  const second = runner(context);

  try {
    const recovered = await waitFor(context, recurring.path, (value) =>
      value.history.some((item) => item.cycleOrdinal === "1" && item.state === "drafted"),
    );

    expect(recovered.history.find((item) => item.cycleOrdinal === "1")?.draftId).toBe(before);
    expect(recovered.generation).toBe(enrollment.generation);

    const count = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2 AND cycle_ordinal=1",
      [context.book.bookId, recurring.record.id],
    );

    expect(count.rows[0]?.count).toBe(1);
    await writeFile(
      join(environment().artifacts, "recurring-recovery.json"),
      JSON.stringify(recovered, null, 2),
    );
  } finally {
    await stop(second.child);
    await admin.end();
  }
});

test("scoped agreement pages and scanner continuation cover 1000 agreements without an implicit 240 cycle horizon", async () => {
  const context = await legalFixture();
  const agreements: Array<string> = [];

  for (let index = 0; index < 1000; index++) {
    const recurring = await agreement(context, `P08 bounded agreement ${index}`, "2026-09-01");
    await enroll(context, recurring.path, "1");
    agreements.push(recurring.record.id);
  }

  const pages: Array<string> = [];
  let cursor: string | null = null;

  do {
    const page: typeof AgreementPage.Type = await decoded(
      await request(
        context.author,
        `/commerce/recurring-invoices${cursor === null ? "" : `?after=${encodeURIComponent(cursor)}`}`,
      ),
      AgreementPage,
    );

    pages.push(...page.items.map((item) => item.id));
    cursor = page.continuation;
  } while (cursor !== null);

  expect(agreements.every((id) => pages.includes(id))).toBe(true);
  const admin = await database();

  const scanClock = await admin.query<{ instant: string }>(
    "SELECT (extract(epoch FROM clock_timestamp())*1000)::text AS instant",
  );

  const scanStart = scanClock.rows[0]?.instant;

  if (scanStart === undefined) throw new Error("Missing database scan clock");
  const start = performance.now();
  const process = runner(context);

  try {
    const deadline = Date.now() + 90000;
    let count = 0;

    while (count < 1000 && Date.now() < deadline) {
      const observed = await admin.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM openerp.recurring_invoice_draft_jobs WHERE book_id=$1 AND state='drafted'",
        [context.book.bookId],
      );

      count = observed.rows[0]?.count ?? 0;

      if (count < 1000) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }

    expect(count).toBe(1000);

    const performance = await admin.query<{
      p50: number;
      p95: number;
      queueP50: number;
      queueP95: number;
      scanDuration: number;
      admissionSpan: number;
      examined: number;
      drafts: number;
    }>(
      `
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM j.settled_at-q.processed_at)*1000) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM j.settled_at-q.processed_at)*1000) AS p95,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM q.processed_at-j.created_at)*1000) AS "queueP50",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM q.processed_at-j.created_at)*1000) AS "queueP95",
        (extract(epoch FROM max(j.created_at))*1000-$2::numeric)::double precision AS "scanDuration",
        (extract(epoch FROM max(j.created_at)-min(j.created_at))*1000)::double precision AS "admissionSpan",
        (SELECT count(*)::int FROM openerp.recurring_invoice_draft_schedules WHERE book_id=$1 AND next_cycle_ordinal > 1) AS examined,
        (SELECT count(*)::int FROM openerp.invoice_drafts d JOIN openerp.recurring_invoice_occurrences o ON o.book_id=d.book_id AND o.draft_id=d.id WHERE d.book_id=$1) AS drafts
      FROM openerp.recurring_invoice_draft_jobs j JOIN public.effect_mq_jobs q
        ON q.id='recurring-invoice-draft/'||j.book_id||'/'||j.id||'/'||j.generation::text
      WHERE j.book_id=$1 AND j.state='drafted'`,
      [context.book.bookId, scanStart],
    );

    expect(performance.rows[0]?.drafts).toBe(1000);
    expect(performance.rows[0]?.examined).toBe(1000);
    expect(performance.rows[0]?.p95).toBeLessThanOrEqual(3000);
    expect(performance.rows[0]?.admissionSpan).toBeGreaterThan(0);
    await writeFile(
      join(environment().artifacts, "performance.json"),
      JSON.stringify(
        {
          agreements: 1000,
          elapsedMs: globalThis.performance.now() - start,
          claimedToDraftP50Ms: performance.rows[0]?.p50,
          claimedToDraftP95Ms: performance.rows[0]?.p95,
          queueWaitP50Ms: performance.rows[0]?.queueP50,
          queueWaitP95Ms: performance.rows[0]?.queueP95,
          dueScanMs: performance.rows[0]?.scanDuration,
          admissionSpanMs: performance.rows[0]?.admissionSpan,
          examined: performance.rows[0]?.examined,
          drafts: performance.rows[0]?.drafts,
          pages: pages.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await stop(process.child);
    await admin.end();
  }
}, 180000);

test("commercial drafts remain admissible after 200 retained records", async () => {
  const context = await legalFixture();
  const source = context.original.draftSnapshot.content;
  let last: typeof Drafts.InvoiceDraftRevision.Type | undefined;
  const durations: number[] = [];
  const admittedIds = [context.original.draftId];

  for (let index = 0; index < 205; index++) {
    const start = performance.now();

    last = await post(
      context.author,
      "/commerce/invoice-drafts",
      {
        draftKey: `p08_lifetime_${index}_${context.book.bookId}`,
        commercial: {
          title: "P08 lifetime inventory proof",
          counterpartyId: source.counterpartyId,
          counterpartyRevision: source.counterpartyRevision,
          seller: source.seller,
          customer: source.customer,
          plannedIssueDate: context.today,
          supplyDate: context.today,
          dueDate: context.today,
          paymentTerms: "Synthetic immediate terms",
          lines: commercialTemplate(context).lines,
        },
      },
      Drafts.InvoiceDraftRevision,
    );
    durations.push(performance.now() - start);
    admittedIds.push(last.id);

    if (index === 24) {
      const ordered = [...durations].sort((left, right) => left - right);

      await writeFile(
        join(environment().artifacts, "basic-draft-performance.json"),
        JSON.stringify(
          {
            path: "POST /commerce/invoice-drafts",
            fixtures: 25,
            p50Ms: ordered[12],
            p95Ms: ordered[23],
            feature: "existing commercial draft admission",
          },
          null,
          2,
        ),
      );
    }
  }

  expect(last?.totals.grossMinor).toBe("3756");
  const admin = await database();

  try {
    const count = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.invoice_drafts WHERE book_id=$1",
      [context.book.bookId],
    );

    expect(count.rows[0]?.count).toBe(206);
    const listResponse = await request(context.author, "/commerce/invoice-drafts");

    await writeFile(
      join(environment().artifacts, "recurring-lifetime-list-probe.json"),
      JSON.stringify(
        {
          scope: { entityId: context.book.entityId, bookId: context.book.bookId },
          retainedCount: count.rows[0]?.count,
          admittedIds,
          last,
          listStatus: listResponse.status,
          listBody: await listResponse.clone().text(),
        },
        null,
        2,
      ),
    );
    const first = await decoded(listResponse, DraftInventoryPage);

    expect(first).toMatchObject({
      scope: { entityId: context.book.entityId, bookId: context.book.bookId },
      count: 200,
      complete: false,
    });
    expect(first.items).toHaveLength(200);
    expect(first.continuation).toBe(first.items.at(-1)?.id);

    const next = await decoded(
      await request(
        context.author,
        `/commerce/invoice-drafts?after=${encodeURIComponent(first.continuation ?? "")}`,
      ),
      DraftInventoryPage,
    );

    expect(next).toMatchObject({ count: 6, complete: false, continuation: null });
    expect(next.items).toHaveLength(6);
    const listed = [...first.items, ...next.items].map((item) => item.id);

    expect(new Set(listed).size).toBe(206);
    expect([...listed].sort()).toEqual([...admittedIds].sort());

    const filtered = await decoded(
      await request(
        context.author,
        "/commerce/invoice-drafts?search=%20P08%20LIFETIME%20inventory%20proof%20",
      ),
      DraftInventoryPage,
    );

    expect(filtered.items).toHaveLength(200);

    const filteredNext = await decoded(
      await request(
        context.author,
        `/commerce/invoice-drafts?search=P08%20lifetime%20inventory%20proof&after=${encodeURIComponent(filtered.continuation ?? "")}`,
      ),
      DraftInventoryPage,
    );

    expect(filteredNext.items).toHaveLength(5);
    expect(filteredNext.continuation).toBeNull();

    const literalSearch = await decoded(
      await request(context.author, "/commerce/invoice-drafts?search=%25"),
      DraftInventoryPage,
    );

    expect(literalSearch).toMatchObject({
      count: 0,
      complete: true,
      continuation: null,
      items: [],
    });

    const rpc = await fetch(`${environment().baseUrl}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${context.author.agentToken}`,
        "content-type": "application/json",
        accept: "application/json",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "commerce_list_invoice_drafts",
          arguments: {
            scope: { entityId: context.book.entityId, bookId: context.book.bookId },
            after: first.continuation,
          },
        },
      }),
    });

    expect(rpc.status).toBe(200);

    const rpcResult = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({ structuredContent: Schema.Struct({ result: DraftInventoryPage }) }),
      }),
    )(await rpc.json());

    expect(rpcResult.result.structuredContent.result.items.map((item) => item.id)).toEqual(
      next.items.map((item) => item.id),
    );
    const browserActor = await fixture();
    await admin.query(
      "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
      [context.book.bookId, browserActor.actorId],
    );
    await withWorkspaceBrowser(
      { ...context.book, actorId: browserActor.actorId },
      "recurring-lifetime-directory",
      async (page, workspace) => {
        await page.goto(`${workspace}/sales?view=issue`);
        const loadMore = page.getByRole("button", { name: "Load more drafts", exact: true });

        await loadMore.waitFor();
        await loadMore.click();
        const picker = page.getByRole("combobox", { name: "Invoice draft", exact: true });

        await picker.click();
        await expect.poll(() => page.getByRole("option").count()).toBe(207);
        await page.screenshot({
          path: join(environment().artifacts, "recurring-lifetime-directory.png"),
          fullPage: true,
        });
        await page.keyboard.press("Escape");

        const searched = page.waitForResponse(
          (response) =>
            response.url().includes("/invoice-drafts?search=%25") &&
            response.request().method() === "GET",
        );

        await page.getByRole("textbox", { name: "Search invoice drafts", exact: true }).fill("%");
        expect((await searched).status()).toBe(200);
        await expect.poll(() => loadMore.count()).toBe(0);
        await picker.click();
        await expect.poll(() => page.getByRole("option").count()).toBe(1);
      },
    );
    const other = await legalFixture();

    await failure(
      await request(
        context.author,
        `/commerce/invoice-drafts?after=${encodeURIComponent(other.original.draftId)}`,
      ),
      404,
      "NotFound",
    );
    const late = next.items.at(-1);

    if (late === undefined)
      throw new Error("The second actual inventory page must contain a reviewable draft.");

    const reviewedDraft = await decoded(
      await request(context.author, `/commerce/invoice-drafts/${late.id}`),
      Drafts.InvoiceDraftView,
    );

    const review = await post(
      context.author,
      "/commerce/ar-legal-issue-reviews",
      {
        profile: "se-domestic-b2b-sek-25-accrual-v1",
        draftId: reviewedDraft.record.id,
        expectedRevision: reviewedDraft.record.revision,
        expectedDigest: reviewedDraft.record.digest,
        policyId: context.original.policyId,
        policyDigest: context.original.policyDigest,
        accountingProfileId: context.profile.id,
        accountingProfileDigest: context.profile.digest,
        controlAccountId: "account_ar",
        revenueAccountId: "account_revenue",
        outputVatAccountId: "account_vat",
        accountingPeriodId: "period_2026",
        voucherSeries: "A",
        reason: "Normal review remains available after the first inventory page",
        acknowledgeLimitedProfile: true,
      },
      Ar.ArLegalIssueReview,
    );

    expect(review.totals).toEqual({ netMinor: "3005", taxMinor: "751", grossMinor: "3756" });

    const issues = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.ar_legal_issues WHERE book_id=$1",
      [context.book.bookId],
    );

    expect(issues.rows[0]?.count).toBe(1);
    await writeFile(
      join(environment().artifacts, "recurring-lifetime-inventory.json"),
      JSON.stringify(
        {
          count: count.rows[0]?.count,
          last,
          first,
          next,
          filtered,
          filteredNext,
          literalSearch,
          rpcResult,
          reviewedDraft,
          review,
          issues: issues.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.end();
  }
});

test("durable work inventory binds recurring enrollment, examined cursor and actual cycle occupancy", async () => {
  const context = await legalFixture();
  const recurring = await agreement(context, "P08 retained recovery boundary");

  await enroll(context, recurring.path, "1");
  const process = runner(context);
  const admin = await database();

  try {
    await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.state === "drafted"),
    );
    await stop(process.child);
    await admin.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = await tableFingerprints(admin);
    const inventory = await captureWorkInventory(admin, tables, "synthetic-recurring-snapshot");

    const body = Schema.decodeUnknownSync(
      Schema.Struct({
        version: Schema.Literal(3),
        recurringSchedules: Schema.Array(
          Schema.Struct({
            bookId: Schema.String,
            agreementId: Schema.String,
            nextCycleOrdinal: Schema.String,
          }),
        ),
        recurringJobs: Schema.Array(
          Schema.Struct({
            bookId: Schema.String,
            agreementId: Schema.String,
            state: Schema.String,
            draftId: Schema.NullOr(Schema.String),
          }),
        ),
        recurringEvents: Schema.Array(
          Schema.Struct({
            bookId: Schema.String,
            agreementId: Schema.String,
            generation: Schema.String,
          }),
        ),
        resumptionAuthority: Schema.Literal("not-granted"),
      }),
    )(inventory);

    expect(
      body.recurringSchedules.find((row) => row.agreementId === recurring.record.id)
        ?.nextCycleOrdinal,
    ).not.toBe("1");
    expect(
      body.recurringJobs.some(
        (row) =>
          row.agreementId === recurring.record.id &&
          row.state === "drafted" &&
          row.draftId !== null,
      ),
    ).toBe(true);
    expect(
      body.recurringEvents.filter((row) => row.agreementId === recurring.record.id),
    ).toHaveLength(1);
    await admin.query("ROLLBACK");
    await writeFile(
      join(environment().artifacts, "recurring-durable-work-inventory.json"),
      JSON.stringify(inventory, null, 2),
    );
  } finally {
    await admin.query("ROLLBACK");
    await stop(process.child);
    await admin.end();
  }
});

test("a killed runner between queue enqueue and application acknowledgement recovers the stable occurrence", async () => {
  const context = await legalFixture();
  const recurring = await agreement(context, "P08 enqueue acknowledgement crash", "2026-09-01");

  await enroll(context, recurring.path, "1");
  const admin = await database();
  let first: ReturnType<typeof runner> | undefined;
  let second: ReturnType<typeof runner> | undefined;

  try {
    await admin.query(`CREATE FUNCTION openerp.p08_hold_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.book_id='${context.book.bookId}' AND OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL THEN PERFORM pg_sleep(30); END IF; RETURN NEW; END $$`);
    await admin.query(
      "CREATE TRIGGER p08_hold_dispatch BEFORE UPDATE ON openerp.recurring_invoice_draft_jobs FOR EACH ROW EXECUTE FUNCTION openerp.p08_hold_dispatch()",
    );
    first = runner(context);
    await expect
      .poll(
        async () => {
          const result = await admin.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM public.effect_mq_jobs WHERE name='recurring-invoice-draft' AND metadata->>'bookId'=$1",
            [context.book.bookId],
          );

          return result.rows[0]?.count;
        },
        { timeout: 15000 },
      )
      .toBe(1);

    const before = await admin.query<{ id: string; dispatched_at: string | null }>(
      "SELECT id,dispatched_at FROM openerp.recurring_invoice_draft_jobs WHERE book_id=$1",
      [context.book.bookId],
    );

    expect(before.rows[0]?.dispatched_at).toBe(null);
    const killed = once(first.child, "exit");

    first.child.kill("SIGKILL");
    await killed;
    await admin.query("DROP TRIGGER p08_hold_dispatch ON openerp.recurring_invoice_draft_jobs");
    await admin.query("DROP FUNCTION openerp.p08_hold_dispatch()");
    second = runner(context);

    const recovered = await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.state === "drafted"),
    );

    const occurrence = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, recurring.record.id],
    );

    expect(occurrence.rows[0]?.count).toBe(1);
    expect(recovered.history.filter((job) => job.cycleOrdinal === "1")).toHaveLength(1);
    await writeFile(
      join(environment().artifacts, "recurring-enqueue-crash.json"),
      JSON.stringify({ before: before.rows, recovered, queueLog: first.log() }, null, 2),
    );
  } finally {
    if (first) await stop(first.child);

    if (second) await stop(second.child);
    await admin.query(
      "DROP TRIGGER IF EXISTS p08_hold_dispatch ON openerp.recurring_invoice_draft_jobs",
    );
    await admin.query("DROP FUNCTION IF EXISTS openerp.p08_hold_dispatch()");
    await admin.end();
  }
}, 120000);

test("a retained commercial template freezes its catalog revision and refuses a stale new selection", async () => {
  const context = await legalFixture();
  const base = commercialTemplate(context);
  const firstLine = base.lines[0];

  if (firstLine === undefined) throw new Error("Missing commercial fixture line");

  const articleInput = {
    code: "P08-FROZEN",
    expectedRevision: 0,
    description: "Retained recurring service",
    unit: "month",
    unitPriceMinor: "1001",
    taxDescription: null,
    status: "active" as const,
    treatment: firstLine.treatment,
  };

  const article = await post(context.author, "/commerce/articles", articleInput, Catalog.Article);

  const copied = {
    ...base,
    lines: base.lines.map((line) => ({
      ...line,
      description: article.description,
      catalogSelection: {
        scope: article.scope,
        digest: article.digest,
        code: article.code,
        revision: article.revision,
        unit: article.unit,
      },
    })),
  };

  const recurring = await agreement(context, "P08 frozen commercial master", "2026-09-01", copied);

  await post(
    context.author,
    "/commerce/articles",
    { ...articleInput, expectedRevision: 1, unitPriceMinor: "9001", status: "archived" },
    Catalog.Article,
  );
  await failure(
    await request(context.author, `${recurring.path}/template-revisions`, {
      method: "POST",
      body: JSON.stringify({ ...recurring.input, effectiveFromCycle: "2" }),
    }),
    409,
    "StaleDependency",
  );
  await enroll(context, recurring.path, "1");
  const process = runner(context);

  try {
    const completed = await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.state === "drafted"),
    );

    const draftId = completed.history.find((job) => job.state === "drafted")?.draftId;

    if (!draftId) throw new Error("Missing retained recurring draft");

    const view = await decoded(
      await request(context.author, `/commerce/invoice-drafts/${draftId}`),
      Drafts.InvoiceDraftView,
    );

    expect(view.record.totals).toMatchObject({
      netMinor: "3005",
      taxMinor: "751",
      grossMinor: "3756",
    });
    expect(view.record.purpose).toBe("commercial");

    if (view.record.purpose !== "commercial") throw new Error("Missing commercial snapshot");
    expect(view.record.commercialInput.lines[0]?.catalogSelection?.revision).toBe(1);
    expect(view.record.recurringTemplateOrigin?.digest).toBe(recurring.template.digest);
    await writeFile(
      join(environment().artifacts, "recurring-frozen-master.json"),
      JSON.stringify(view, null, 2),
    );
  } finally {
    await stop(process.child);
  }
});

test("a killed runner after draft commit before queue acknowledgement preserves the selected template", async () => {
  const context = await legalFixture();

  const recurring = await agreement(
    context,
    "P08 committed draft acknowledgement crash",
    "2026-09-01",
  );

  await enroll(context, recurring.path, "1");
  const admin = await database();
  let first: ReturnType<typeof runner> | undefined;
  let second: ReturnType<typeof runner> | undefined;

  try {
    await admin.query(`CREATE FUNCTION public.p08_hold_queue_ack() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name='recurring-invoice-draft' AND NEW.metadata->>'bookId'='${context.book.bookId}' AND NEW.state='completed' THEN PERFORM pg_sleep(30); END IF; RETURN NEW; END $$`);
    await admin.query(
      "CREATE TRIGGER p08_hold_queue_ack BEFORE UPDATE ON public.effect_mq_jobs FOR EACH ROW EXECUTE FUNCTION public.p08_hold_queue_ack()",
    );
    first = runner(context);

    const committed = await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.state === "drafted"),
    );

    const draftId = committed.history.find((job) => job.state === "drafted")?.draftId;

    if (draftId === undefined || draftId === null) throw new Error("Missing committed draft");

    const before = await admin.query<{ state: string }>(
      "SELECT state FROM public.effect_mq_jobs WHERE name='recurring-invoice-draft' AND metadata->>'bookId'=$1",
      [context.book.bookId],
    );

    expect(before.rows[0]?.state).toBe("active");
    const killed = once(first.child, "exit");

    first.child.kill("SIGKILL");
    await killed;
    await admin.query("DROP TRIGGER p08_hold_queue_ack ON public.effect_mq_jobs");
    await admin.query("DROP FUNCTION public.p08_hold_queue_ack()");
    await post(
      context.author,
      `${recurring.path}/template-revisions`,
      {
        ...recurring.input,
        effectiveFromCycle: "2",
        template: { ...recurring.input.template, title: "Changed future template" },
      },
      Recurring.RecurringTemplateRevision,
    );
    second = runner(context);
    await expect
      .poll(
        async () => {
          const queue = await admin.query<{ state: string }>(
            "SELECT state FROM public.effect_mq_jobs WHERE name='recurring-invoice-draft' AND metadata->>'bookId'=$1",
            [context.book.bookId],
          );

          return queue.rows[0]?.state;
        },
        { timeout: 45000 },
      )
      .toBe("completed");
    const recovered = await state(context, recurring.path);

    const occurrence = await decoded(
      await request(context.author, `${recurring.path}/occurrences/1`),
      Recurring.RecurringOccurrenceView,
    );

    expect(recovered.history.find((job) => job.cycleOrdinal === "1")?.draftId).toBe(draftId);
    expect(occurrence.occurrence.selectedTemplateRevision).toBe("1");
    expect(occurrence.occurrence.selectedTemplateDigest).toBe(recurring.template.digest);

    const count = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, recurring.record.id],
    );

    expect(count.rows[0]?.count).toBe(1);
    await writeFile(
      join(environment().artifacts, "recurring-committed-crash.json"),
      JSON.stringify({ before: before.rows, committed, recovered, occurrence }, null, 2),
    );
  } finally {
    if (first) await stop(first.child);

    if (second) await stop(second.child);
    await admin.query("DROP TRIGGER IF EXISTS p08_hold_queue_ack ON public.effect_mq_jobs");
    await admin.query("DROP FUNCTION IF EXISTS public.p08_hold_queue_ack()");
    await admin.end();
  }
}, 120000);

test("pause and resume after retained admission fence the old intent even when the cycle is due again", async () => {
  const context = await legalFixture();
  const recurring = await agreement(context, "P08 complete event history fence", "2026-09-01");

  await enroll(context, recurring.path, "1");
  const admin = await database();
  let first: ReturnType<typeof runner> | undefined;
  let second: ReturnType<typeof runner> | undefined;

  try {
    await admin.query(`CREATE FUNCTION openerp.p08_hold_event_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.book_id='${context.book.bookId}' AND OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL THEN PERFORM pg_sleep(30); END IF; RETURN NEW; END $$`);
    await admin.query(
      "CREATE TRIGGER p08_hold_event_dispatch BEFORE UPDATE ON openerp.recurring_invoice_draft_jobs FOR EACH ROW EXECUTE FUNCTION openerp.p08_hold_event_dispatch()",
    );
    first = runner(context);
    await expect
      .poll(
        async () => {
          const queue = await admin.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM public.effect_mq_jobs WHERE name='recurring-invoice-draft' AND metadata->>'bookId'=$1",
            [context.book.bookId],
          );

          return queue.rows[0]?.count;
        },
        { timeout: 15000 },
      )
      .toBe(1);
    const killed = once(first.child, "exit");

    first.child.kill("SIGKILL");
    await killed;
    await admin.query(
      "DROP TRIGGER p08_hold_event_dispatch ON openerp.recurring_invoice_draft_jobs",
    );
    await admin.query("DROP FUNCTION openerp.p08_hold_event_dispatch()");
    await event(context, recurring, "pause", "1");
    await event(context, recurring, "resume", "1");
    second = runner(context);

    const stopped = await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.state === "failed" && job.reason === "StaleDependency"),
    );

    const before = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, recurring.record.id],
    );

    expect(before.rows[0]?.count).toBe(0);
    await post(
      context.author,
      `${recurring.path}/scheduling/catch-up`,
      {
        expectedGeneration: stopped.generation,
        cycleOrdinals: ["1"],
        confirmCatchUp: true,
        reason: "Review current complete event history",
      },
      Scheduling,
    );

    const recovered = await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.state === "drafted" && job.generation === "2"),
    );

    await event(context, recurring, "end", "2");
    await failure(
      await request(context.author, `${recurring.path}/scheduling/catch-up`, {
        method: "POST",
        body: JSON.stringify({
          expectedGeneration: recovered.generation,
          cycleOrdinals: ["1"],
          confirmCatchUp: true,
          reason: "End must refuse a new catch-up witness",
        }),
      }),
      409,
      "StaleDependency",
    );
    await writeFile(
      join(environment().artifacts, "recurring-complete-event-fence.json"),
      JSON.stringify({ stopped, recovered }, null, 2),
    );
  } finally {
    if (first) await stop(first.child);

    if (second) await stop(second.child);
    await admin.query(
      "DROP TRIGGER IF EXISTS p08_hold_event_dispatch ON openerp.recurring_invoice_draft_jobs",
    );
    await admin.query("DROP FUNCTION IF EXISTS openerp.p08_hold_event_dispatch()");
    await admin.end();
  }
}, 120000);

test("confirmed automatic enrollment beyond cycle240 creates no earlier backlog", async () => {
  const context = await legalFixture();
  const recurring = await agreement(context, "P08 explicit distant enrollment", "2000-01-31");
  const enrollment = await enroll(context, recurring.path, "250");

  expect(enrollment.firstAutomaticCycle).toBe("250");
  const process = runner(context);

  try {
    const completed = await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.cycleOrdinal === "250" && job.state === "drafted"),
    );

    expect(completed.history.every((job) => BigInt(job.cycleOrdinal) >= 250n)).toBe(true);
    const admin = await database();

    try {
      const earlier = await admin.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2 AND cycle_ordinal < 250",
        [context.book.bookId, recurring.record.id],
      );

      expect(earlier.rows[0]?.count).toBe(0);
      await writeFile(
        join(environment().artifacts, "recurring-distant-enrollment.json"),
        JSON.stringify({ enrollment, completed }, null, 2),
      );
    } finally {
      await admin.end();
    }
  } finally {
    await stop(process.child);
  }
});

test("effective schedule zones use one scan instant and an unqualified zone cannot strand another agreement", async () => {
  const context = await legalFixture();

  const pair = [
    await agreement(context, "P08 calendar first"),
    await agreement(context, "P08 calendar second"),
  ].sort((left, right) =>
    left.record.id < right.record.id ? -1 : left.record.id > right.record.id ? 1 : 0,
  );

  const bad = pair[0];
  const good = pair[1];

  if (bad === undefined || good === undefined) throw new Error("Missing calendar agreements");

  for (const [record, timeZone] of [
    [bad, "Etc/P08_Unqualified"],
    [good, "UTC"],
  ] as const) {
    await post(
      context.author,
      `${record.path}/schedules`,
      {
        expectedAgreementRevision: record.record.revision,
        expectedAgreementDigest: record.record.digest,
        effectiveFromCycle: "2",
        schedule: { ...record.record.schedule, timeZone },
        reason: "Explicit effective calendar change",
      },
      Recurring.RecurringScheduleRevision,
    );
  }

  await failure(
    await request(context.author, `${bad.path}/scheduling`, {
      method: "POST",
      body: JSON.stringify({
        expectedGeneration: "0",
        enabled: true,
        firstAutomaticCycle: "2",
        duePolicy: "local_calendar_date_v1",
        confirmFirstAutomaticCycle: true,
        reason: "Unqualified starting calendar must refuse",
      }),
    }),
    422,
    "UnsupportedProfile",
  );
  await enroll(context, bad.path, "1");
  await enroll(context, good.path, "1");
  const process = runner(context);
  const admin = await database();

  try {
    const completed = await waitFor(context, good.path, (value) =>
      value.history.some((job) => job.cycleOrdinal === "2" && job.state === "drafted"),
    );

    const failed = await waitFor(context, bad.path, (value) =>
      value.history.some(
        (job) =>
          job.cycleOrdinal === "2" &&
          job.state === "failed" &&
          job.reason === "unqualified_time_zone",
      ),
    );

    const rows = await admin.query<{
      agreementId: string;
      cycle: string;
      basis: Schema.JsonObject;
    }>(
      `SELECT agreement_id AS "agreementId",cycle_ordinal::text AS cycle,admitted AS basis FROM openerp.recurring_invoice_draft_jobs WHERE book_id=$1 ORDER BY agreement_id COLLATE "C",cycle_ordinal`,
      [context.book.bookId],
    );

    const invalid = rows.rows.find((row) => row.agreementId === bad.record.id && row.cycle === "2");
    const valid = rows.rows.find((row) => row.agreementId === good.record.id && row.cycle === "2");

    expect(invalid?.basis).toMatchObject({
      timeZone: "Etc/P08_Unqualified",
      localDate: null,
      cycleDate: "2026-03-31",
    });
    expect(valid?.basis.timeZone).toBe("UTC");
    expect(new Set(rows.rows.map((row) => row.basis.capturedAt)).size).toBe(1);
    await writeFile(
      join(environment().artifacts, "recurring-qualified-calendar.json"),
      JSON.stringify({ failed, completed, rows: rows.rows }, null, 2),
    );
  } finally {
    await stop(process.child);
    await admin.end();
  }
});

test("a late occurrence failure rolls back the ordinary draft and stable receipt before explicit retry", async () => {
  const context = await legalFixture();
  const recurring = await agreement(context, "P08 atomic occurrence failure", "2026-09-01");

  await enroll(context, recurring.path, "1");
  const admin = await database();

  const before = await admin.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM openerp.invoice_drafts WHERE book_id=$1",
    [context.book.bookId],
  );

  let process: ReturnType<typeof runner> | undefined;

  try {
    await admin.query(`CREATE FUNCTION openerp.p08_refuse_occurrence() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.book_id='${context.book.bookId}' AND NEW.agreement_id='${recurring.record.id}' THEN RAISE EXCEPTION 'synthetic late occurrence refusal' USING ERRCODE='P0001', DETAIL='StaleDependency'; END IF; RETURN NEW; END $$`);
    await admin.query(
      "CREATE TRIGGER p08_refuse_occurrence BEFORE INSERT ON openerp.recurring_invoice_occurrences FOR EACH ROW EXECUTE FUNCTION openerp.p08_refuse_occurrence()",
    );
    process = runner(context);

    const stopped = await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.state === "failed" && job.reason === "StaleDependency"),
    );

    const rolledBack = await admin.query<{ drafts: number; occurrences: number; receipts: number }>(
      `SELECT
      (SELECT count(*)::int FROM openerp.invoice_drafts WHERE book_id=$1) AS drafts,
      (SELECT count(*)::int FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2) AS occurrences,
      (SELECT count(*)::int FROM openerp.command_receipts WHERE book_id=$1 AND key=$3) AS receipts`,
      [context.book.bookId, recurring.record.id, `recurring_cycle_${recurring.record.id}_1`],
    );

    expect(rolledBack.rows[0]).toEqual({
      drafts: before.rows[0]?.count,
      occurrences: 0,
      receipts: 0,
    });
    await admin.query(
      "DROP TRIGGER p08_refuse_occurrence ON openerp.recurring_invoice_occurrences",
    );
    await admin.query("DROP FUNCTION openerp.p08_refuse_occurrence()");
    await post(
      context.author,
      `${recurring.path}/scheduling/catch-up`,
      {
        expectedGeneration: stopped.generation,
        cycleOrdinals: ["1"],
        confirmCatchUp: true,
        reason: "Retry the rolled back cycle after reviewing its retained inputs",
      },
      Scheduling,
    );

    const recovered = await waitFor(context, recurring.path, (value) =>
      value.history.some((job) => job.generation === "2" && job.state === "drafted"),
    );

    const after = await admin.query<{ drafts: number; occurrences: number }>(
      `SELECT
      (SELECT count(*)::int FROM openerp.invoice_drafts WHERE book_id=$1) AS drafts,
      (SELECT count(*)::int FROM openerp.recurring_invoice_occurrences WHERE book_id=$1 AND agreement_id=$2) AS occurrences`,
      [context.book.bookId, recurring.record.id],
    );

    expect(after.rows[0]).toEqual({ drafts: (before.rows[0]?.count ?? 0) + 1, occurrences: 1 });
    await writeFile(
      join(environment().artifacts, "recurring-atomic-retry.json"),
      JSON.stringify(
        { stopped, rolledBack: rolledBack.rows, recovered, after: after.rows },
        null,
        2,
      ),
    );
  } finally {
    if (process) await stop(process.child);
    await admin.query(
      "DROP TRIGGER IF EXISTS p08_refuse_occurrence ON openerp.recurring_invoice_occurrences",
    );
    await admin.query("DROP FUNCTION IF EXISTS openerp.p08_refuse_occurrence()");
    await admin.end();
  }
});

test("a retained pre-P08 agreement initializes its missing schedule with current authority and real source provenance", async () => {
  const context = await legalFixture();

  const record = await post(
    context.author,
    "/commerce/recurring-invoices",
    {
      customerId: context.customer.id,
      title: "P08 historical agreement schedule initialization",
      schedule: {
        anchorLocalDate: "2026-09-01",
        timeZone: "Europe/Stockholm",
        cadence: {
          kind: "monthly",
          monthInterval: "1",
          dayInterval: null,
          monthAnchorPolicy: "anchor_day_clamped",
        },
        firstCycleOrdinal: "1",
      },
      reason: "Actual authorized agreement creation receipt",
    },
    Recurring.RecurringAgreement,
  );

  const path = `/commerce/recurring-invoices/${record.id}`;
  const admin = await database();
  let process: ReturnType<typeof runner> | undefined;

  try {
    await admin.query("BEGIN");
    await admin.query(
      "ALTER TABLE openerp.recurring_invoice_agreement_schedules DISABLE TRIGGER immutable_recurring_invoice_agreement_schedule",
    );
    await admin.query(
      "DELETE FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, record.id],
    );
    await admin.query(
      "ALTER TABLE openerp.recurring_invoice_agreement_schedules ENABLE TRIGGER immutable_recurring_invoice_agreement_schedule",
    );
    await admin.query("COMMIT");

    const missing = await decoded(
      await request(context.author, path),
      Recurring.RecurringAgreementView,
    );

    expect(missing.schedules).toHaveLength(0);

    const template = await post(
      context.reviewer,
      `${path}/template-revisions`,
      {
        expectedAgreementRevision: record.revision,
        expectedAgreementDigest: record.digest,
        effectiveFromCycle: "1",
        chargeComponentKeys: ["service"],
        template: commercialTemplate(context),
        reason: "Current operator initializes from the retained agreement",
      },
      Recurring.RecurringTemplateRevision,
    );

    const rows = await admin.query<{ body: unknown }>(
      "SELECT body FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, record.id],
    );

    const initial = Schema.decodeUnknownSync(Recurring.RecurringScheduleRevision)(
      rows.rows[0]?.body,
    );

    expect(rows.rowCount).toBe(1);
    expect(initial).toMatchObject({
      revision: "1",
      effectiveFromCycle: "1",
      schedule: record.schedule,
      agreementDigest: record.digest,
      origin: {
        kind: "retained_agreement",
        sourceCreatedAt: record.createdAt,
        sourceReceipt: record.receipt,
      },
      receipt: {
        key: template.receipt.key,
        operation: "propose_recurring_template_revision",
        actorId: context.reviewer.actorId,
      },
    });
    expect(initial.createdAt).not.toBe(record.createdAt);
    await admin.query("BEGIN");
    await admin.query(
      "ALTER TABLE openerp.recurring_invoice_agreement_schedules DISABLE TRIGGER immutable_recurring_invoice_agreement_schedule",
    );
    await admin.query(
      "DELETE FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, record.id],
    );
    await admin.query(
      "ALTER TABLE openerp.recurring_invoice_agreement_schedules ENABLE TRIGGER immutable_recurring_invoice_agreement_schedule",
    );
    await admin.query("COMMIT");
    await enroll({ ...context, author: context.reviewer }, path, "1");

    const enrolledRows = await admin.query<{ body: unknown }>(
      "SELECT body FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, record.id],
    );

    const enrolledSchedule = Schema.decodeUnknownSync(Recurring.RecurringScheduleRevision)(
      enrolledRows.rows[0]?.body,
    );

    expect(enrolledSchedule).toMatchObject({
      origin: {
        kind: "retained_agreement",
        sourceCreatedAt: record.createdAt,
        sourceReceipt: record.receipt,
      },
      receipt: { operation: "set_recurring_draft_scheduling", actorId: context.reviewer.actorId },
    });
    process = runner(context);

    const completed = await waitFor(context, path, (value) =>
      value.history.some((job) => job.state === "drafted"),
    );

    const occurrence = await decoded(
      await request(context.author, `${path}/occurrences/1`),
      Recurring.RecurringOccurrenceView,
    );

    expect(occurrence.occurrence.selectedScheduleRevision).toBe("1");
    await writeFile(
      join(environment().artifacts, "recurring-historical-initialization.json"),
      JSON.stringify(
        { record, initial, enrolledSchedule, template, completed, occurrence },
        null,
        2,
      ),
    );
  } finally {
    await admin.query("ROLLBACK");

    if (process) await stop(process.child);
    await admin.end();
  }
});

test("a retained source template stays manual while the current schedules owner initializes its exact source calendar", async () => {
  const context = await legalFixture();

  const record = await post(
    context.author,
    "/commerce/recurring-invoices",
    {
      customerId: context.customer.id,
      title: "P08 legacy source template manual boundary",
      schedule: {
        anchorLocalDate: "2026-09-01",
        timeZone: "Europe/Stockholm",
        cadence: {
          kind: "monthly",
          monthInterval: "1",
          dayInterval: null,
          monthAnchorPolicy: "anchor_day_clamped",
        },
        firstCycleOrdinal: "1",
      },
      reason: "Retained source agreement",
    },
    Recurring.RecurringAgreement,
  );

  const path = `/commerce/recurring-invoices/${record.id}`;
  const source = context.original.draftSnapshot.content;

  await post(
    context.author,
    `${path}/template-revisions`,
    {
      expectedAgreementRevision: record.revision,
      expectedAgreementDigest: record.digest,
      effectiveFromCycle: "1",
      chargeComponentKeys: ["service"],
      template: {
        title: "Legacy source template",
        counterpartyId: source.counterpartyId,
        seller: source.seller,
        customer: source.customer,
        currency: "SEK",
        currencyScale: 2,
        paymentTerms: source.paymentTerms,
        dateOffsets: { issueDays: "0", supplyDays: "0", dueDays: "14" },
        sourceTotalMinor: source.sourceTotalMinor,
        lines: source.lines,
      },
      reason: "Keep manual source template semantics",
    },
    Recurring.RecurringTemplateRevision,
  );
  const admin = await database();

  try {
    await admin.query("BEGIN");
    await admin.query(
      "ALTER TABLE openerp.recurring_invoice_agreement_schedules DISABLE TRIGGER immutable_recurring_invoice_agreement_schedule",
    );
    await admin.query(
      "DELETE FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, record.id],
    );
    await admin.query(
      "ALTER TABLE openerp.recurring_invoice_agreement_schedules ENABLE TRIGGER immutable_recurring_invoice_agreement_schedule",
    );
    await admin.query("COMMIT");
    await failure(
      await request(context.reviewer, `${path}/scheduling`, {
        method: "POST",
        body: JSON.stringify({
          expectedGeneration: "0",
          enabled: true,
          firstAutomaticCycle: "1",
          duePolicy: "local_calendar_date_v1",
          confirmFirstAutomaticCycle: true,
          reason: "Source totals must not enable automatic commercial drafting",
        }),
      }),
      422,
      "UnsupportedProfile",
    );

    const absent = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, record.id],
    );

    expect(absent.rows[0]?.count).toBe(0);

    const initialized = await post(
      context.reviewer,
      `${path}/schedules`,
      {
        expectedAgreementRevision: record.revision,
        expectedAgreementDigest: record.digest,
        effectiveFromCycle: "1",
        schedule: record.schedule,
        reason: "Initialize the exact retained source schedule for manual materialization",
      },
      Recurring.RecurringScheduleRevision,
    );

    expect(initialized).toMatchObject({
      revision: "1",
      schedule: record.schedule,
      origin: {
        kind: "retained_agreement",
        sourceCreatedAt: record.createdAt,
        sourceReceipt: record.receipt,
      },
      receipt: { operation: "amend_recurring_schedule", actorId: context.reviewer.actorId },
    });
    expect(initialized.createdAt).not.toBe(record.createdAt);

    const occurrence = await post(
      context.reviewer,
      `${path}/occurrences`,
      { cycleOrdinal: "1", reason: "Explicit manual source occurrence" },
      Recurring.RecurringOccurrence,
    );

    expect(occurrence.selectedScheduleRevision).toBe("1");
    await writeFile(
      join(environment().artifacts, "recurring-legacy-manual-boundary.json"),
      JSON.stringify({ record, initialized, occurrence }, null, 2),
    );
  } finally {
    await admin.query("ROLLBACK");
    await admin.end();
  }
});

test("a retained late amendment leaves the original segment importable without replacing its occupied revision or an original-boundary override", async () => {
  const context = await legalFixture();
  const manual = await agreement(context, "P08 late amendment manual initialization", "2026-01-01");

  const automatic = await agreement(
    context,
    "P08 late amendment automatic initialization",
    "2026-01-01",
  );

  const overridden = await agreement(
    context,
    "P08 existing original boundary override",
    "2026-01-01",
  );

  const admin = await database();
  let process: ReturnType<typeof runner> | undefined;

  try {
    const amendments = [];

    for (const retained of [manual, automatic, overridden]) {
      await admin.query("BEGIN");
      await admin.query(
        "ALTER TABLE openerp.recurring_invoice_agreement_schedules DISABLE TRIGGER immutable_recurring_invoice_agreement_schedule",
      );
      await admin.query(
        "DELETE FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2",
        [context.book.bookId, retained.record.id],
      );
      await admin.query(
        "ALTER TABLE openerp.recurring_invoice_agreement_schedules ENABLE TRIGGER immutable_recurring_invoice_agreement_schedule",
      );
      await admin.query("COMMIT");

      const amended = await post(
        context.reviewer,
        `${retained.path}/schedules`,
        {
          expectedAgreementRevision: retained.record.revision,
          expectedAgreementDigest: retained.record.digest,
          effectiveFromCycle: retained === overridden ? "1" : "4",
          schedule: {
            ...retained.record.schedule,
            cadence: { ...retained.record.schedule.cadence, monthInterval: "3" },
          },
          reason: "Actual operator amendment retained before original segment initialization",
        },
        Recurring.RecurringScheduleRevision,
      );

      expect(amended.revision).toBe("1");
      amendments.push(amended);
    }

    const later = await post(
      context.reviewer,
      `${manual.path}/occurrences`,
      { cycleOrdinal: "4", reason: "Explicit later occurrence before original segment import" },
      Recurring.RecurringOccurrence,
    );

    expect(later).toMatchObject({ cycleDate: "2027-01-01", selectedScheduleRevision: "1" });

    const imported = await post(
      context.reviewer,
      `${manual.path}/schedules`,
      {
        expectedAgreementRevision: manual.record.revision,
        expectedAgreementDigest: manual.record.digest,
        effectiveFromCycle: "1",
        schedule: manual.record.schedule,
        reason: "Import the retained original segment without touching the later occurrence",
      },
      Recurring.RecurringScheduleRevision,
    );

    expect(imported).toMatchObject({
      revision: "2",
      effectiveFromCycle: "1",
      schedule: manual.record.schedule,
      origin: {
        kind: "retained_agreement",
        sourceCreatedAt: manual.record.createdAt,
        sourceReceipt: manual.record.receipt,
      },
      receipt: { operation: "amend_recurring_schedule", actorId: context.reviewer.actorId },
    });

    const laterAfter = await decoded(
      await request(context.author, `${manual.path}/occurrences/4`),
      Recurring.RecurringOccurrenceView,
    );

    expect(laterAfter.occurrence).toEqual(later);

    const manualEnrollment = await enroll(
      { ...context, author: context.reviewer },
      manual.path,
      "1",
    );

    const automaticEnrollment = await enroll(
      { ...context, author: context.reviewer },
      automatic.path,
      "1",
    );

    const overrideEnrollment = await enroll(
      { ...context, author: context.reviewer },
      overridden.path,
      "1",
    );

    expect(manualEnrollment.nextCycleDate).toBe("2026-02-01");
    expect(automaticEnrollment.nextCycleDate).toBe("2026-02-01");
    expect(overrideEnrollment.nextCycleDate).toBe("2026-04-01");

    const automaticView = await decoded(
      await request(context.author, automatic.path),
      Recurring.RecurringAgreementView,
    );

    const overrideView = await decoded(
      await request(context.author, overridden.path),
      Recurring.RecurringAgreementView,
    );

    expect(automaticView.schedules).toHaveLength(2);

    const automaticRows = await admin.query<{ body: unknown }>(
      "SELECT body FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2 ORDER BY revision",
      [context.book.bookId, automatic.record.id],
    );

    const automaticSchedules = automaticRows.rows.map((row) =>
      Schema.decodeUnknownSync(Recurring.RecurringScheduleRevision)(row.body),
    );

    expect(automaticSchedules[0]).toEqual(amendments[1]);
    expect(automaticSchedules[1]).toMatchObject({
      effectiveFromCycle: "1",
      schedule: automatic.record.schedule,
      origin: { kind: "retained_agreement", sourceReceipt: automatic.record.receipt },
      receipt: { operation: "set_recurring_draft_scheduling", actorId: context.reviewer.actorId },
    });

    const overrideRows = await admin.query<{ body: unknown }>(
      "SELECT body FROM openerp.recurring_invoice_agreement_schedules WHERE book_id=$1 AND agreement_id=$2",
      [context.book.bookId, overridden.record.id],
    );

    expect(overrideView.schedules).toHaveLength(1);
    expect(overrideRows.rows[0]?.body).toEqual(amendments[2]);
    process = runner(context);

    const completed = await Promise.all(
      [manual, automatic, overridden].map((retained) =>
        waitFor(context, retained.path, (value) =>
          value.history.some((job) => job.cycleOrdinal === "1" && job.state === "drafted"),
        ),
      ),
    );

    const early = await decoded(
      await request(context.author, `${manual.path}/occurrences/1`),
      Recurring.RecurringOccurrenceView,
    );

    expect(early.occurrence).toMatchObject({
      cycleDate: "2026-02-01",
      selectedScheduleRevision: "2",
    });
    await writeFile(
      join(environment().artifacts, "recurring-late-initial-segment.json"),
      JSON.stringify(
        { amendments, later, imported, laterAfter, automaticView, overrideView, completed, early },
        null,
        2,
      ),
    );
  } finally {
    await admin.query("ROLLBACK");

    if (process) await stop(process.child);
    await admin.end();
  }
});
