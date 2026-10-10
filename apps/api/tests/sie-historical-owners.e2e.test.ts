import { assertEvaluationRefused } from "./support/decision-examples";
import { provenanceRows } from "./support/decision-provenance";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Import from "@open-erp/contracts/sie-import";
import * as Partitions from "@open-erp/contracts/sie-partitions";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Adoption from "@open-erp/contracts/historical-adoptions";
import * as Dimensions from "@open-erp/contracts/dimensions";
import * as Sie4E from "@open-erp/contracts/sie4e";
import { parseSie } from "../src/application/sie-import-parser";
import * as Intake from "@open-erp/contracts/source-intake";
import {
  approve,
  createSession,
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  ledger,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

async function setup() {
  const book = await fixture([{ id: "account_ar", code: "1510", name: "Historical receivable" }]);
  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.fiscal_years(book_id,id,starts_on,ends_on) values($1,'fy_2025','2025-01-01','2025-12-31')",
      [book.bookId],
    );
    await admin.query(
      "insert into openerp.periods(book_id,id,fiscal_year_id,starts_on,ends_on) values($1,'period_2025','fy_2025','2025-01-01','2025-12-31')",
      [book.bookId],
    );
    await admin.query(
      "insert into openerp.commerce_control_accounts(book_id,account_id,direction) values($1,'account_ar','customer')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  return book;
}

const mappings = [
  { sourceAccount: "1930", accountId: "account_bank" },
  { sourceAccount: "1510", accountId: "account_ar" },
  { sourceAccount: "2999", accountId: "account_clearing" },
];

const amounts2025 = [
  { sourceAccount: "1930", opening: "0", closing: "0" },
  { sourceAccount: "1510", opening: "0", closing: "40000" },
  { sourceAccount: "2999", opening: "0", closing: "-40000" },
];

const amounts2026 = [
  { sourceAccount: "1930", opening: "0", closing: "10000" },
  { sourceAccount: "1510", opening: "40000", closing: "30000" },
  { sourceAccount: "2999", opening: "-40000", closing: "-40000" },
];

function controls(rows: typeof amounts2025, year: string) {
  return rows.map((row) => ({
    sourceAccount: row.sourceAccount,
    year,
    independentOpeningMinor: row.opening,
    independentClosingMinor: row.closing,
    basis: "Independent synthetic account controls",
  }));
}

function sourceControls(rows: typeof amounts2025, year: string) {
  return rows.flatMap((row) => [
    `#IB ${year} ${row.sourceAccount} ${(BigInt(row.opening) / 100n).toString()}.00`,
    `#UB ${year} ${row.sourceAccount} ${(BigInt(row.closing) / 100n).toString()}.00`,
  ]);
}

async function retain(
  book: BookFixture,
  multi: boolean,
  missingAccount = false,
  pair = false,
  sourceSystem = "synthetic_sie_historical_owners",
  residual = "40000",
) {
  const yearControls = pair
    ? amounts2025.map((row) => ({ ...row, closing: (BigInt(row.closing) * 2n).toString() }))
    : amounts2025;

  const content =
    [
      "#FLAGGA 0",
      "#FORMAT PC8",
      "#SIETYP 4",
      "#RAR -1 20250101 20251231",
      ...(multi
        ? [
            "#RAR 0 20260101 20261231",
            '#DIM 1 "Department"',
            '#OBJEKT 1 "DEP-A" "Imported department"',
          ]
        : []),
      ...sourceControls(
        missingAccount ? yearControls.filter((row) => row.sourceAccount !== "1510") : yearControls,
        "-1",
      ),
      ...(multi ? sourceControls(amounts2026, "0") : []),
      ...(multi
        ? [
            ...amounts2025.flatMap((row) => [
              `#OIB -1 ${row.sourceAccount} {1 "DEP-A"} ${(BigInt(row.opening) / 100n).toString()}.00`,
              `#OUB -1 ${row.sourceAccount} {1 "DEP-A"} ${(BigInt(row.closing) / 100n).toString()}.00`,
            ]),
            ...amounts2026.flatMap((row) => [
              `#OIB 0 ${row.sourceAccount} {1 "DEP-A"} ${(BigInt(row.opening) / 100n).toString()}.00`,
              `#OUB 0 ${row.sourceAccount} {1 "DEP-A"} ${(BigInt(row.closing) / 100n).toString()}.00`,
            ]),
          ]
        : []),
      "#VER A 1 20251231",
      "{",
      `#TRANS 1510 ${multi ? '{1 "DEP-A"}' : "{}"} 400.00`,
      `#TRANS 2999 ${multi ? '{1 "DEP-A"}' : "{}"} -400.00`,
      "}",
      ...(pair
        ? ["#VER A 2 20251231", "{", "#TRANS 1510 {} 400.00", "#TRANS 2999 {} -400.00", "}"]
        : []),
      ...(multi
        ? [
            "#VER A 1 20260131",
            "{",
            '#TRANS 1930 {1 "DEP-A"} 100.00',
            '#TRANS 1510 {1 "DEP-A"} -100.00',
            '#RTRANS 1510 {1 "DEP-A"} -900.00',
            "}",
          ]
        : []),
    ].join("\r\n") + "\r\n";

  const source = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem,
      sourceAccountId: "Synthetic source book",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "history.SE",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(content).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const preview = await post(
    book,
    `/source-occurrences/${source.id}/sie-previews`,
    { encoding: "ibm437", ...(multi ? { profile: "synthetic_sie4_partition_v1" } : {}) },
    Import.SiePreview,
  );

  expect(preview.ready, JSON.stringify(preview.diagnostics)).toBe(true);

  const plan = await post(
    book,
    `/sie-previews/${preview.id}/plans`,
    {
      digest: preview.digest,
      mappings,
      openingControls: [
        ...controls(
          missingAccount
            ? yearControls.filter((row) => row.sourceAccount !== "1510")
            : yearControls,
          "-1",
        ),
        ...(multi ? controls(amounts2026, "0") : []),
      ],
      openItems: multi
        ? []
        : [
            {
              sourceIdentity: "source_invoice_001",
              sourceAccount: "1510",
              currency: "SEK",
              originalMinor: "100000",
              outstandingMinor: residual,
              asOf: "2025-12-31",
              assertedState: "partly_paid",
              detailAvailability: "source_asserted",
              basis: "Original invoice and historical payment receipt",
            },
          ],
      openItemControls: multi
        ? []
        : [
            {
              sourceAccount: "1510",
              currency: "SEK",
              independentOutstandingMinor: residual,
              basis: "Independent synthetic residual inventory",
            },
          ],
      rationale: "Retain original history and exact source controls",
      openingPolicy: "unreconstructable_detail",
      sourceKind: "synthetic",
    },
    Import.SiePlan,
  );

  const run = await post(
    book,
    `/sie-plans/${plan.id}/runs`,
    { digest: plan.digest },
    Import.SieRunStart,
  );

  await post(
    book,
    `/sie-runs/${run.id}/chunks`,
    { fence: run.fence, planDigest: plan.digest, firstOrdinal: 1 },
    Import.SieChunk,
  );

  return { preview, plan, run, content };
}

function partitionInput(source: Awaited<ReturnType<typeof retain>>, multi: boolean) {
  return {
    previewId: source.preview.id,
    previewDigest: source.preview.digest,
    sourcePlanId: source.plan.id,
    sourcePlanDigest: source.plan.digest,
    fiscalMappings: [
      { sourceYear: "-1", fiscalYearId: "fy_2025" },
      ...(multi ? [{ sourceYear: "0", fiscalYearId: "fy_2026" }] : []),
    ],
    dimensionMappings: multi ? [{ sourceDimensionId: "1", dimensionCode: "Department" }] : [],
    objectMappings: multi
      ? [{ sourceDimensionId: "1", sourceObjectCode: "DEP-A", valueCode: "DEPT-A" }]
      : [],
    dialect: "synthetic_sie4_final_trans_v1",
    rationale: "Review exact source years and original tags",
  };
}

async function start(
  book: BookFixture,
  source: Awaited<ReturnType<typeof retain>>,
  partition?: typeof Partitions.Partition.Type,
) {
  await post(
    book,
    "/historical-bases",
    {
      fiscalYearId: "fy_2025",
      mode: "full_history",
      cutoverOn: "2025-01-01",
      sourcePlanId: source.plan.id,
      sourceDigest: source.plan.digest,
      changeSetId: null,
      controls: mappings.map((row) => ({
        accountId: row.accountId,
        signedMinor: "0",
        basis: "Explicit zero opening",
      })),
      rationale: "Select full retained history",
      partitionId: partition?.id,
    },
    Historical.Basis,
  );

  return post(
    book,
    `/sie-runs/${source.run.id}/financial-runs`,
    { fiscalYearId: "fy_2025", planDigest: source.plan.digest, partitionId: partition?.id },
    Historical.RunStart,
  );
}

async function prepare(book: BookFixture, run: typeof Historical.RunStart.Type, year: string) {
  return post(
    book,
    `/sie-financial-runs/${run.id}/proposals`,
    {
      fence: run.fence,
      planDigest: run.planDigest,
      ordinal: run.nextOrdinal,
      accountingPeriodId: year,
      series: "A",
      rationale: "Approve this exact retained source voucher",
    },
    Accounting.ChangeSet,
  );
}

async function advance(
  book: BookFixture,
  run: typeof Historical.RunStart.Type,
  proposal: typeof Accounting.ChangeSet.Type,
) {
  const approval = await approve(book, proposal);

  return post(
    book,
    `/sie-financial-runs/${run.id}/chunks`,
    {
      fence: run.fence,
      planDigest: run.planDigest,
      firstOrdinal: run.nextOrdinal,
      items: [
        { changeSetId: proposal.id, planDigest: proposal.planDigest, approvalId: approval.id },
      ],
    },
    Historical.Chunk,
  );
}

async function catalogue(book: BookFixture) {
  await post(
    book,
    "/dimensions",
    {
      code: "Department",
      name: "Department",
      expectedRevision: 0,
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
      archived: false,
    },
    Dimensions.DimensionSaved,
  );
  await post(
    book,
    "/dimensions/values",
    {
      dimensionCode: "Department",
      code: "DEPT-A",
      name: "Imported department",
      expectedRevision: 0,
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
      archived: false,
    },
    Dimensions.DimensionValueSaved,
  );
}

test("SIE partition migrates scoped years, original dimensions, history and fenced recovery", async () => {
  const book = await setup();
  await catalogue(book);
  const source = await retain(book, true);
  const input = partitionInput(source, true);
  const partitionKey = key();
  const partitionObserver = await database();
  let partitionRows: unknown;

  try {
    await failure(
      await request(book, "/sie-partitions", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          fiscalMappings: [
            { sourceYear: "-1", fiscalYearId: "fy_2026" },
            { sourceYear: "0", fiscalYearId: "fy_2025" },
          ],
        }),
      }),
      422,
      "InvalidJournal",
    );
    expect(
      (
        await partitionObserver.query(
          "select count(*)::text as count from openerp.sie_source_year_partitions where book_id=$1",
          [book.bookId],
        )
      ).rows,
    ).toEqual([{ count: "0" }]);
  } finally {
    await partitionObserver.end();
  }

  const partition = await decoded(
    await request(book, "/sie-partitions", {
      method: "POST",
      headers: { "idempotency-key": partitionKey },
      body: JSON.stringify(input),
    }),
    Partitions.Partition,
  );

  const partitionRead = await decoded(
    await request(book, `/sie-partitions/${partition.id}`),
    Partitions.Partition,
  );

  const partitionReplay = await decoded(
    await request(book, "/sie-partitions", {
      method: "POST",
      headers: { "idempotency-key": partitionKey },
      body: JSON.stringify(input),
    }),
    Partitions.Partition,
  );

  expect(partitionRead).toEqual(partition);
  expect(partitionReplay).toEqual(partition);
  await failure(
    await request(book, "/sie-partitions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    409,
    "AlreadyPosted",
  );
  const partitionDatabase = await database();

  try {
    partitionRows = (
      await partitionDatabase.query(
        "select id,digest from openerp.sie_source_year_partitions where book_id=$1",
        [book.bookId],
      )
    ).rows;
    expect(partitionRows).toEqual([{ id: partition.id, digest: partition.digest }]);
  } finally {
    await partitionDatabase.end();
  }

  expect((await ledger(book)).sequence).toBe("0");

  expect(partition.vouchers.map((row) => row.scopedIdentity)).toEqual(["0/A/1", "1/A/1"]);
  expect(
    partition.years.map(
      (year) => year.controls.find((row) => row.accountId === "account_ar")?.closingMinor,
    ),
  ).toEqual(["40000", "30000"]);
  expect(partition.vouchers[0]?.lines[0]?.originalDimensions?.[0]).toEqual({
    dimensionCode: "Department",
    dimensionRevision: 1,
    status: "explicit",
    valueCode: "DEPT-A",
    valueRevision: 1,
    capturedLabel: "Imported department",
    exemptionEvidenceId: null,
    sourceValueCode: "DEP-A",
  });
  let run = await start(book, source, partition);
  const first = await prepare(book, run, "period_2025");
  await advance(book, run, first);
  run = await decoded(await request(book, `/sie-financial-runs/${run.id}`), Historical.Run);
  expect([run.fiscalYearId, run.nextOrdinal, run.status]).toEqual(["fy_2026", 2, "running"]);

  const paused = await post(
    book,
    `/sie-financial-runs/${run.id}/lease`,
    { action: "pause" },
    Historical.Fence,
  );

  await failure(
    await request(book, `/sie-financial-runs/${run.id}/proposals`, {
      method: "POST",
      body: JSON.stringify({
        fence: run.fence,
        planDigest: run.planDigest,
        ordinal: 2,
        accountingPeriodId: "period_2026",
        series: "A",
        rationale: "Old fence",
      }),
    }),
    409,
    "StaleDependency",
  );

  const manual = await post(
    book,
    "/change-sets",
    {
      ...journal((await evidence(book)).id),
      dimensionPolicy: [
        {
          dimensionCode: "Department",
          requirement: "optional",
          fixedValueCode: null,
          fixedValueRevision: null,
          defaultValueCode: null,
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const manualApproval = await approve(book, manual);
  await failure(
    await request(book, `/change-sets/${manual.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: manual.planDigest,
        approvalId: manualApproval.id,
      }),
    }),
    409,
    "StaleDependency",
  );

  const resumed = await post(
    book,
    `/sie-financial-runs/${run.id}/lease`,
    { action: "resume" },
    Historical.Fence,
  );

  run = { ...run, ...resumed };
  const second = await prepare(book, run, "period_2026");

  const approved = await approve(book, second),
    command = {
      fence: run.fence,
      planDigest: run.planDigest,
      firstOrdinal: 2,
      items: [{ changeSetId: second.id, planDigest: second.planDigest, approvalId: approved.id }],
    },
    idempotency = key();

  const committed = await decoded(
    await request(book, `/sie-financial-runs/${run.id}/chunks`, {
      method: "POST",
      headers: { "idempotency-key": idempotency },
      body: JSON.stringify(command),
    }),
    Historical.Chunk,
  );

  const replay = await decoded(
    await request(book, `/sie-financial-runs/${run.id}/chunks`, {
      method: "POST",
      headers: { "idempotency-key": idempotency },
      body: JSON.stringify(command),
    }),
    Historical.Chunk,
  );

  expect(replay).toEqual(committed);

  const comparison = await decoded(
    await request(book, `/sie-runs/${source.run.id}/closing-comparison`),
    Historical.ClosingComparison,
  );

  expect([comparison.postingComplete, comparison.balanced]).toEqual([true, true]);
  expect(comparison.items.map((row) => [row.code, row.actualMinor])).toEqual([
    ["1510", "30000"],
    ["1930", "10000"],
    ["2999", "-40000"],
  ]);
  const final = await ledger(book);
  expect(final.sequence).toBe("2");
  const admin = await database();
  let tags: unknown;

  try {
    expect(
      (
        await admin.query("select count(*)::text as count from openerp.vouchers where book_id=$1", [
          book.bookId,
        ])
      ).rows,
    ).toEqual([{ count: "2" }]);
    tags = (
      await admin.query(
        "select source_value_code,value_code from openerp.journal_line_dimensions where book_id=$1 order by voucher_id,line_id",
        [book.bookId],
      )
    ).rows;
  } finally {
    await admin.end();
  }

  expect(tags).toEqual(
    Array.from({ length: 4 }, () => ({ source_value_code: "DEP-A", value_code: "DEPT-A" })),
  );

  const retained = await decoded(
    await request(book, `/sie-previews/${source.preview.id}`),
    Import.SiePreview,
  );

  expect(retained.vouchers[1]?.transactions.map((row) => [row.kind, row.amount])).toEqual([
    ["TRANS", "100.00"],
    ["TRANS", "-100.00"],
    ["RTRANS", "-900.00"],
  ]);

  const exported = await post(
    book,
    "/sie-book-exports",
    {
      fiscalYearId: "fy_2026",
      asOf: "2026-12-31",
      legalName: "Synthetic SIE AB",
      organizationNumber: "555555-5555",
      legalNameEvidenceId: (await evidence(book)).id,
      accountClassifications: [
        { accountId: "account_ar", accountClass: "balance_sheet" },
        { accountId: "account_bank", accountClass: "balance_sheet" },
        { accountId: "account_clearing", accountClass: "balance_sheet" },
      ],
    },
    Sie4E.Sie4EView,
  );

  if (!exported.artifact) throw new Error("Missing verified roundtrip artifact");
  const bytes = Buffer.from(exported.artifact.contentBase64, "base64");
  const roundtrip = parseSie(bytes, "ibm437", "export_validation");
  expect(roundtrip.records.filter((row) => row.tag === "OBJEKT").map((row) => row.fields)).toEqual([
    ["20", "DEPT-A", "Imported department"],
  ]);
  expect(
    roundtrip.vouchers
      .flatMap((row) => row.transactions)
      .map((row) => [row.kind, row.account, row.dimensions, row.amount]),
  ).toEqual([
    ["TRANS", "1930", "{20 DEPT-A}", "100.00"],
    ["TRANS", "1510", "{20 DEPT-A}", "-100.00"],
  ]);
  expect(
    roundtrip.records
      .filter((row) => row.tag === "OIB" || row.tag === "OUB")
      .map((row) => [row.tag, ...row.fields.slice(0, 4)]),
  ).toEqual([
    ["OIB", "0", "1510", "{20 DEPT-A}", "400.00"],
    ["OIB", "0", "1930", "{20 DEPT-A}", "0.00"],
    ["OIB", "0", "2999", "{20 DEPT-A}", "-400.00"],
    ["OUB", "0", "1510", "{20 DEPT-A}", "300.00"],
    ["OUB", "0", "1930", "{20 DEPT-A}", "100.00"],
    ["OUB", "0", "2999", "{20 DEPT-A}", "-400.00"],
  ]);
  await writeFile(join(environment().artifacts, "sie-partition-roundtrip.SE"), bytes);
  await writeFile(
    join(environment().artifacts, "sie-partition-journey.json"),
    JSON.stringify(
      {
        partition,
        partitionRead,
        partitionReplay,
        partitionRows,
        partitionRefusals: [
          { status: 422, code: "InvalidJournal", retainedPartitions: "0" },
          { status: 409, code: "AlreadyPosted", retainedPartitions: "1" },
        ],
        paused,
        resumed,
        committed,
        replay,
        comparison,
        tags,
        retainedSource: retained,
        exported,
        roundtrip,
      },
      null,
      2,
    ),
  );
});

test("SIE account omission refuses a balanced aggregate and writes no declaration", async () => {
  const book = await setup(),
    source = await retain(book, false, true);

  await failure(
    await request(book, "/sie-partitions", {
      method: "POST",
      body: JSON.stringify(partitionInput(source, false)),
    }),
    422,
    "InvalidJournal",
  );
  expect((await ledger(book)).sequence).toBe("0");
  const admin = await database();

  try {
    expect(
      (
        await admin.query(
          "select count(*)::text as count from openerp.sie_source_year_partitions where book_id=$1",
          [book.bookId],
        )
      ).rows,
    ).toEqual([{ count: "0" }]);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "sie-missing-account-refusal.json"),
    JSON.stringify(
      { expectedCode: "InvalidJournal", sequence: "0", sourcePreview: source.preview },
      null,
      2,
    ),
  );
});

test("historical adoption conserves retained residual and exact new payment capacity", async () => {
  const book = await setup(),
    source = await retain(book, false);

  let run = await start(book, source);
  await advance(book, run, await prepare(book, run, "period_2025"));
  run = await decoded(await request(book, `/sie-financial-runs/${run.id}`), Historical.Run);
  expect(run.status).toBe("posted");

  const admission = await post(
    book,
    `/sie-plans/${source.plan.id}/historical-items`,
    {
      planDigest: source.plan.digest,
      payments: [
        {
          sourceIdentity: "prior_payment",
          sourceAccount: "1510",
          currency: "SEK",
          amountMinor: "60000",
          sourceDate: null,
          basis: "Historical receipt",
        },
      ],
      matches: [
        {
          sourceIdentity: "prior_match",
          itemIdentity: "source_invoice_001",
          paymentIdentity: "prior_payment",
          amountMinor: "60000",
          sourceDate: null,
          basis: "Historical allocation",
        },
      ],
      paymentControls: [
        {
          sourceAccount: "1510",
          currency: "SEK",
          independentTotalMinor: "60000",
          basis: "Source payment total",
        },
      ],
      matchControls: [
        {
          sourceAccount: "1510",
          currency: "SEK",
          independentTotalMinor: "60000",
          basis: "Source allocation total",
        },
      ],
      chronology: "unknown",
      rationale: "Retain original and prior payment lineage",
    },
    Historical.ItemAdmission,
  );

  const pool = await post(
    book,
    "/historical-pools",
    {
      admissionId: admission.id,
      admissionDigest: admission.digest,
      basisFiscalYearId: "fy_2025",
      cutoverOn: "2025-12-31",
      sourceAccount: "1510",
      direction: "AR",
      rationale: "Verify the GL and independent residual pool",
    },
    Adoption.Pool,
  );

  expect(pool.exactResidualMinor).toBe("40000");
  await failure(
    await request(book, "/historical-pools", {
      method: "POST",
      body: JSON.stringify({ ...pool.input, cutoverOn: "2026-12-31" }),
    }),
    409,
    "AlreadyPosted",
  );
  const alternate = await retain(book, false, false, false, "synthetic_second_namespace");

  const alternateAdmission = await post(
    book,
    `/sie-plans/${alternate.plan.id}/historical-items`,
    {
      planDigest: alternate.plan.digest,
      payments: admission.payments,
      matches: admission.matches,
      paymentControls: admission.paymentControls,
      matchControls: admission.matchControls,
      chronology: admission.chronology,
      rationale: "Retain alternate namespace without granting second control capacity",
    },
    Historical.ItemAdmission,
  );

  await failure(
    await request(book, "/historical-pools", {
      method: "POST",
      body: JSON.stringify({
        ...pool.input,
        admissionId: alternateAdmission.id,
        admissionDigest: alternateAdmission.digest,
        cutoverOn: "2026-12-31",
      }),
    }),
    409,
    "AlreadyPosted",
  );
  expect((await ledger(book)).sequence).toBe("1");

  const plan = await post(
    book,
    "/historical-adoption-plans",
    {
      poolId: pool.id,
      poolDigest: pool.digest,
      sourceIdentity: "source_invoice_001",
      rationale: "Adopt residual without recognition",
    },
    Adoption.AdoptionPlan,
  );

  await failure(
    await request(book, `/historical-adoption-plans/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ digest: plan.digest }),
    }),
    403,
    "Forbidden",
  );
  const browser = { ...book, token: (await createSession(book)).token };

  const approval = await post(
    browser,
    `/historical-adoption-plans/${plan.id}/approvals`,
    { digest: plan.digest },
    Adoption.Approval,
  );

  const idempotency = key(),
    command = { digest: plan.digest, approvalId: approval.id };

  const adoption = await decoded(
    await request(book, `/historical-adoption-plans/${plan.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": idempotency },
      body: JSON.stringify(command),
    }),
    Adoption.Adoption,
  );

  const replay = await decoded(
    await request(book, `/historical-adoption-plans/${plan.id}/execute`, {
      method: "POST",
      headers: { "idempotency-key": idempotency },
      body: JSON.stringify(command),
    }),
    Adoption.Adoption,
  );

  expect(replay).toEqual(adoption);
  expect([
    adoption.openingResidualMinor,
    adoption.glDeltaMinor,
    adoption.journalIds,
    (await ledger(book)).sequence,
  ]).toEqual(["40000", "0", [], "1"]);
  await failure(
    await request(book, "/historical-adoption-plans", {
      method: "POST",
      body: JSON.stringify(plan.input),
    }),
    409,
    "AlreadyPosted",
  );
  await failure(
    await request(
      { ...book, token: book.agentToken },
      `/historical-adoption-plans/${plan.id}/execute`,
      { method: "POST", body: JSON.stringify(command) },
    ),
    403,
    "Forbidden",
  );
  const other = await fixture();
  await failure(await request(other, `/historical-pools/${pool.id}`), 404, "NotFound");

  const before = await decoded(
    await request(book, `/historical-obligations/${adoption.id}`),
    Adoption.Obligation,
  );

  const paymentInput = journal((await evidence(book)).id, "10000");

  const paymentPlan = await post(
    book,
    "/change-sets",
    {
      ...paymentInput,
      postingDate: "2026-01-15",
      lines: paymentInput.lines.map((line, index) =>
        index === 1 ? { ...line, accountId: "account_ar" } : line,
      ),
    },
    Accounting.ChangeSet,
  );

  const payment = await execute(book, paymentPlan),
    paymentLine = paymentPlan.groups[0]!.actions[0]!.lines[1]!.lineId;

  const settlementInput = {
    adoptionId: adoption.id,
    expectedVersion: before.version,
    paymentVoucherId: payment.voucherId,
    paymentLineId: paymentLine,
    amountMinor: "10000",
    rationale: "Consume only the new payment",
  };

  const first = await post(
      book,
      "/historical-settlement-plans",
      settlementInput,
      Adoption.SettlementPlan,
    ),
    second = await post(
      book,
      "/historical-settlement-plans",
      settlementInput,
      Adoption.SettlementPlan,
    );

  const firstApproval = await post(
      browser,
      `/historical-settlement-plans/${first.id}/approvals`,
      { digest: first.digest },
      Adoption.Approval,
    ),
    secondApproval = await post(
      browser,
      `/historical-settlement-plans/${second.id}/approvals`,
      { digest: second.digest },
      Adoption.Approval,
    );

  const responses = await Promise.all([
    request(book, `/historical-settlement-plans/${first.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: first.digest, approvalId: firstApproval.id }),
    }),
    request(book, `/historical-settlement-plans/${second.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: second.digest, approvalId: secondApproval.id }),
    }),
  ]);

  expect(responses.map((row) => row.status).sort((left, right) => left - right)).toEqual([
    200, 409,
  ]);
  const winner = responses.find((row) => row.status === 200)!;
  const settlement = await decoded(winner, Adoption.Settlement);
  await failure(
    responses.find((row) => row.status === 409)!,
    409,
    "StaleDependency",
  );

  const after = await decoded(
    await request(book, `/historical-obligations/${adoption.id}`),
    Adoption.Obligation,
  );

  expect([after.remainingMinor, after.settledMinor, (await ledger(book)).sequence]).toEqual([
    "30000",
    "10000",
    "2",
  ]);

  const control = await decoded(
    await request(book, `/historical-pools/${pool.id}`),
    Adoption.PoolControl,
  );

  expect([
    control.adoptedMinor,
    control.unadoptedMinor,
    control.liveMinor,
    control.settledMinor,
    control.complete,
  ]).toEqual(["40000", "0", "30000", "10000", true]);
  await failure(
    await request(book, `/historical-obligations/${adoption.id}/credits`, {
      method: "POST",
      body: JSON.stringify({ rationale: "Residual cannot reconstruct tax" }),
    }),
    422,
    "UnsupportedProfile",
  );
  await writeFile(
    join(environment().artifacts, "historical-adoption-journey.json"),
    JSON.stringify(
      { pool, plan, approval, adoption, replay, payment, settlement, before, after, control },
      null,
      2,
    ),
  );
});

test("SIE multi-member chunk rolls back the first posted member when the second approval refuses", async () => {
  const book = await setup(),
    source = await retain(book, false, false, true);

  const partition = await post(
    book,
    "/sie-partitions",
    partitionInput(source, false),
    Partitions.Partition,
  );

  const run = await start(book, source, partition);
  const first = await prepare(book, run, "period_2025");
  const second = await prepare(book, { ...run, nextOrdinal: 2 }, "period_2025");

  const firstApproval = await approve(book, first),
    secondApproval = await approve(book, second);

  const command = {
    fence: run.fence,
    planDigest: run.planDigest,
    firstOrdinal: 1,
    items: [
      { changeSetId: first.id, planDigest: first.planDigest, approvalId: firstApproval.id },
      { changeSetId: second.id, planDigest: second.planDigest, approvalId: firstApproval.id },
    ],
  };

  await failure(
    await request(book, `/sie-financial-runs/${run.id}/chunks`, {
      method: "POST",
      body: JSON.stringify(command),
    }),
    403,
    "ApprovalRequired",
  );
  expect((await ledger(book)).sequence).toBe("0");
  expect(await provenanceRows(book)).toEqual([]);

  const refused = await decoded(
    await request(book, `/sie-financial-runs/${run.id}`),
    Historical.Run,
  );

  expect([refused.nextOrdinal, refused.items.length, refused.status]).toEqual([1, 0, "running"]);

  const committed = await post(
    book,
    `/sie-financial-runs/${run.id}/chunks`,
    {
      ...command,
      items: [command.items[0], { ...command.items[1], approvalId: secondApproval.id }],
    },
    Historical.Chunk,
  );

  expect([committed.items.length, (await ledger(book)).sequence]).toEqual([2, "2"]);
  const provenance = await provenanceRows(book);
  expect(provenance).toHaveLength(2);
  expect(provenance.every((row) => row.classification === "historical_import")).toBe(true);
  await assertEvaluationRefused(book, provenance[0]!.decision_id);
  await writeFile(
    join(environment().artifacts, "sie-all-or-none.json"),
    JSON.stringify(
      { refused, committed, provenance, sequenceBeforeRecovery: "0", sequenceAfterRecovery: "2" },
      null,
      2,
    ),
  );
});

test("historical pool rereview preserves source and GL while invalidating approval and requiring reconciliation", async () => {
  const book = await setup();
  const source = await retain(book, false);
  const run = await start(book, source);
  await advance(book, run, await prepare(book, run, "period_2025"));

  const admit = async (retained: Awaited<ReturnType<typeof retain>>, paid: string) =>
    post(
      book,
      `/sie-plans/${retained.plan.id}/historical-items`,
      {
        planDigest: retained.plan.digest,
        payments: [
          {
            sourceIdentity: "old_payment",
            sourceAccount: "1510",
            currency: "SEK",
            amountMinor: paid,
            sourceDate: null,
            basis: "Synthetic retained payment source",
          },
        ],
        matches: [
          {
            sourceIdentity: "old_match",
            itemIdentity: "source_invoice_001",
            paymentIdentity: "old_payment",
            amountMinor: paid,
            sourceDate: null,
            basis: "Synthetic reviewed match",
          },
        ],
        paymentControls: [
          {
            sourceAccount: "1510",
            currency: "SEK",
            independentTotalMinor: paid,
            basis: "Independent source payment total",
          },
        ],
        matchControls: [
          {
            sourceAccount: "1510",
            currency: "SEK",
            independentTotalMinor: paid,
            basis: "Independent source match total",
          },
        ],
        chronology: "unknown",
        rationale: "Retain the reviewed source interpretation",
      },
      Historical.ItemAdmission,
    );

  const admission = await admit(source, "60000");

  const pool = await post(
    book,
    "/historical-pools",
    {
      admissionId: admission.id,
      admissionDigest: admission.digest,
      basisFiscalYearId: "fy_2025",
      cutoverOn: "2025-12-31",
      sourceAccount: "1510",
      direction: "AR",
      rationale: "Reviewed source pool",
    },
    Adoption.Pool,
  );

  const plan = await post(
    book,
    "/historical-adoption-plans",
    {
      poolId: pool.id,
      poolDigest: pool.digest,
      sourceIdentity: "source_invoice_001",
      rationale: "Prepare original residual",
    },
    Adoption.AdoptionPlan,
  );

  const browser = { ...book, token: (await createSession(book)).token };

  const approval = await post(
    browser,
    `/historical-adoption-plans/${plan.id}/approvals`,
    { digest: plan.digest },
    Adoption.Approval,
  );

  const reviewed = await retain(
    book,
    false,
    false,
    false,
    "synthetic_sie_historical_owners",
    "30000",
  );

  expect(reviewed.content).toBe(source.content);
  const revisedAdmission = await admit(reviewed, "70000");

  const input = {
    expectedPoolDigest: pool.digest,
    admissionId: revisedAdmission.id,
    admissionDigest: revisedAdmission.digest,
    rationale: "Correct source residual after rereview",
  };

  await failure(
    await request(book, `/historical-pools/${pool.id}/revisions`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
    403,
    "Forbidden",
  );
  const before = await ledger(book);
  const replayKey = key();

  const revise = () =>
    request(browser, `/historical-pools/${pool.id}/revisions`, {
      method: "POST",
      headers: { "idempotency-key": replayKey },
      body: JSON.stringify(input),
    });

  const revision = await decoded(await revise(), Adoption.PoolRevision);
  expect(await decoded(await revise(), Adoption.PoolRevision)).toEqual(revision);

  const view = await decoded(
    await request(book, `/historical-adoption-plans/${plan.id}/workspace`),
    Adoption.AdoptionWorkspace,
  );

  expect([
    view.preparedPool.exactResidualMinor,
    view.currentPool.exactResidualMinor,
    view.glMinor,
    view.differenceMinor,
    view.stale,
    view.adoption,
  ]).toEqual(["40000", "30000", "40000", "10000", true, null]);
  expect(view.approvals).toEqual([approval]);
  expect(
    await decoded(
      await request(book, `/historical-adoption-plans/${plan.id}`),
      Adoption.AdoptionPlan,
    ),
  ).toEqual(plan);
  await failure(
    await request(book, `/historical-adoption-plans/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: plan.digest, approvalId: approval.id }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(browser, `/historical-adoption-plans/${plan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ digest: plan.digest }),
    }),
    409,
    "StaleDependency",
  );
  await failure(
    await request(book, "/historical-adoption-plans", {
      method: "POST",
      body: JSON.stringify({ ...plan.input, poolDigest: revision.pool.digest }),
    }),
    409,
    "StaleDependency",
  );
  expect(await ledger(book)).toEqual(before);
  const other = await fixture();
  await failure(
    await request(other, `/historical-adoption-plans/${plan.id}/workspace`),
    404,
    "NotFound",
  );
  await failure(
    await request(other, `/historical-adoption-plans?after=${plan.id}`),
    404,
    "NotFound",
  );

  const directory = await decoded(
    await request(book, "/historical-adoption-plans"),
    Adoption.AdoptionPage,
  );

  expect(directory.items.map((item) => item.id)).toEqual([plan.id]);

  const restored = await post(
    browser,
    `/historical-pools/${pool.id}/revisions`,
    {
      expectedPoolDigest: revision.pool.digest,
      admissionId: admission.id,
      admissionDigest: admission.digest,
      rationale: "Resolve discrepancy against retained original source",
    },
    Adoption.PoolRevision,
  );

  await failure(
    await request(book, `/historical-adoption-plans/${plan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ digest: plan.digest, approvalId: approval.id }),
    }),
    409,
    "StaleDependency",
  );

  const fresh = await post(
    book,
    "/historical-adoption-plans",
    { ...plan.input, poolDigest: restored.pool.digest },
    Adoption.AdoptionPlan,
  );

  const freshApproval = await post(
    browser,
    `/historical-adoption-plans/${fresh.id}/approvals`,
    { digest: fresh.digest },
    Adoption.Approval,
  );

  const adopted = await post(
    book,
    `/historical-adoption-plans/${fresh.id}/execute`,
    { digest: fresh.digest, approvalId: freshApproval.id },
    Adoption.Adoption,
  );

  expect([adopted.openingResidualMinor, adopted.journalIds, adopted.glDeltaMinor]).toEqual([
    "40000",
    [],
    "0",
  ]);
  expect(await ledger(book)).toEqual(before);
  await failure(
    await request(browser, `/historical-pools/${pool.id}/revisions`, {
      method: "POST",
      body: JSON.stringify({ ...input, expectedPoolDigest: restored.pool.digest }),
    }),
    409,
    "AlreadyPosted",
  );
  await writeFile(
    join(environment().artifacts, "historical-pool-rereview.json"),
    JSON.stringify(
      {
        pool,
        plan,
        approval,
        revision,
        view,
        directory,
        restored,
        fresh,
        freshApproval,
        adopted,
        before,
        after: await ledger(book),
      },
      null,
      2,
    ),
  );
});
