import * as Accounting from "@open-erp/contracts/accounting";
import * as Dimensions from "@open-erp/contracts/dimensions";
import { expect, test } from "vitest";
import {
  decoded,
  database,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

// NEXT-43. Reviewed dimension restatement without editing journals.
//
// The expected amounts here are derived independently from the retained posting
// rows, never by calling the restatement compiler. The counterfactual that
// matters is stated per case: if a restatement ever moved money, edited a
// journal line, or rewrote an original tag, these cases fail.

const department = "Department";

const project = "Project";

function assignment(dimensionCode: string, valueCode: string, capturedLabel: string) {
  return {
    dimensionCode,
    dimensionRevision: 1,
    status: "explicit" as const,
    valueCode,
    valueRevision: 1,
    capturedLabel,
    exemptionEvidenceId: null,
    sourceValueCode: null,
  };
}

const policy = [department, project].map((dimensionCode) => ({
  dimensionCode,
  requirement: "optional" as const,
  fixedValueCode: null,
  fixedValueRevision: null,
  defaultValueCode: null,
}));

// A synthetic catalogue with two departments, so a restatement can move a line
// from one to the other and the movement is observable.
async function catalogue(book: BookFixture) {
  for (const code of [department, project]) {
    await post(
      book,
      "/dimensions",
      {
        code,
        name: code,
        expectedRevision: 0,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        archived: false,
      },
      Dimensions.DimensionSaved,
    );
  }

  for (const valueCode of ["0012", "0099"]) {
    await post(
      book,
      "/dimensions/values",
      {
        dimensionCode: department,
        code: valueCode,
        name: `Department ${valueCode}`,
        expectedRevision: 0,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        archived: false,
      },
      Dimensions.DimensionValueSaved,
    );
  }

  await post(
    book,
    "/dimensions/values",
    {
      dimensionCode: project,
      code: "Case-A",
      name: "Projekt Å",
      expectedRevision: 0,
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
      archived: false,
    },
    Dimensions.DimensionValueSaved,
  );
}

async function setup() {
  const book = await fixture();
  const source = await evidence(book);

  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.fiscal_years(book_id, id, starts_on, ends_on) VALUES ($1, 'fy_2025', '2025-01-01', '2025-12-31')",
      [book.bookId],
    );
    await admin.query(
      "INSERT INTO openerp.periods(book_id, id, fiscal_year_id, starts_on, ends_on) VALUES ($1, 'period_2025', 'fy_2025', '2025-01-01', '2025-12-31')",
      [book.bookId],
    );
  } finally {
    await admin.end();
  }

  return { book, source };
}

// One posted, approved and executed journal whose single debit line carries the
// original tags the restatement will later reclassify.
async function taggedPosting(book: BookFixture, evidenceId: string, valueCode: string) {
  const input = journal(evidenceId, "12500");

  const plan = await post(
    book,
    "/change-sets",
    {
      ...input,
      postingDate: "2025-06-30",
      accountingPeriodId: "period_2025",
      dimensionPolicy: policy,
      lines: input.lines.map((line, index) => ({
        ...line,
        originalDimensions:
          index === 0
            ? [
                assignment(department, valueCode, `Department ${valueCode}`),
                assignment(project, "Case-A", "Projekt Å"),
              ]
            : [],
      })),
    },
    Accounting.ChangeSet,
  );

  const executed = await execute(book, plan);
  const lines = await retainedLines(book.bookId, executed.voucherId);
  const debit = lines.find((line) => line.debit_minor !== "0");

  if (debit === undefined) throw new Error("expected one debited line");

  return { voucherId: executed.voucherId, lineId: debit.line_id, debit };
}

// The retained journal rows of one executed voucher. Reading them outside the
// Worker is independent observation: it is how the test knows which line to
// restate, and how it proves afterwards that the line did not change.
async function retainedLines(bookId: string, voucherId: string) {
  const admin = await database();

  try {
    const result = await admin.query<{
      line_id: string;
      debit_minor: string;
      credit_minor: string;
      account_id: string;
    }>(
      "select jl.id as line_id, jl.debit_minor, jl.credit_minor, jl.account_id from openerp.journal_lines jl where jl.book_id = $1 and jl.voucher_id = $2 order by jl.ordinal",
      [bookId, voucherId],
    );

    return result.rows;
  } finally {
    await admin.end();
  }
}

test("NEXT-43 restates a reviewed classification beside the original tag without editing the journal", async () => {
  const { book, source } = await setup();

  await catalogue(book);

  const posted = await taggedPosting(book, source.id, "0012");
  const voucherId = posted.voucherId;
  const lineId = posted.lineId;

  // Independent expectation, captured before any restatement: the retained
  // journal line and the original tag as recorded at posting.
  const before = posted.debit;

  expect(before.debit_minor).toBe("12500");
  expect(before.account_id).toBe("account_bank");

  const originalView = await decoded(
    await request(
      book,
      `/dimensions/lines/${voucherId}/${lineId}/classification?mode=original&classificationCutoff=2099-12-31`,
    ),
    Dimensions.ClassificationView,
  );

  expect(originalView.resolvedRevisionId).toBe(0);
  expect(originalView.assignments).toEqual([
    { dimensionCode: department, valueCode: "0012", valueRevision: 1 },
    { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
  ]);

  const plan = await post(
    book,
    "/dimensions/restatements",
    {
      analyticalScope: "management_department_view",
      reason: "Synthetic review: the line belongs to department 0099",
      dimensionPolicy: policy,
      lines: [{ voucherId, lineId }],
      changes: [
        {
          lineId: posted.lineId,
          expectedHeadRevision: 0,
          desiredAssignments: [
            { dimensionCode: department, valueCode: "0099", valueRevision: 1 },
            { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
          ],
          reason: "Synthetic reviewed reclassification",
        },
      ],
    },
    Dimensions.RestatementPlanView,
  );

  expect(plan.analyticalScope).toBe("management_department_view");

  const applied = await post(
    book,
    `/dimensions/restatements/${plan.planId}/apply`,
    { version: 1, digest: plan.digest },
    Dimensions.RestatementApplied,
  );

  expect(applied.appendedCount).toBe(1);
  expect(applied.replayedCount).toBe(0);
  expect(applied.lines[0]?.outcome).toBe("appended");
  expect(applied.lines[0]?.revisionId).toBe(1);

  // The reviewed view now resolves the new department, and the original view
  // still resolves the original tag. A retagging that rewrote history would
  // make these two identical.
  const reviewed = await decoded(
    await request(
      book,
      `/dimensions/lines/${voucherId}/${lineId}/classification?mode=reviewed&classificationCutoff=2099-12-31`,
    ),
    Dimensions.ClassificationView,
  );

  expect(reviewed.resolvedRevisionId).toBe(1);
  expect(reviewed.assignments[0]).toEqual({
    dimensionCode: department,
    valueCode: "0099",
    valueRevision: 1,
  });

  const originalAfter = await decoded(
    await request(
      book,
      `/dimensions/lines/${voucherId}/${lineId}/classification?mode=original&classificationCutoff=2099-12-31`,
    ),
    Dimensions.ClassificationView,
  );

  expect(originalAfter.assignments[0]?.valueCode).toBe("0012");

  // Independent observation after the restatement: the journal line is byte
  // identical. This is the counterfactual that matters.
  const after = (await retainedLines(book.bookId, voucherId)).find((row) => row.line_id === lineId);

  expect(after?.debit_minor).toBe(before.debit_minor);
  expect(after?.credit_minor).toBe(before.credit_minor);
  expect(after?.account_id).toBe(before.account_id);
});

test("NEXT-43 refuses to apply a plan whose digest no longer matches the retained plan", async () => {
  const { book, source } = await setup();

  await catalogue(book);

  const posted = await taggedPosting(book, source.id, "0012");

  const plan = await post(
    book,
    "/dimensions/restatements",
    {
      analyticalScope: "management_department_view",
      reason: "Synthetic review",
      dimensionPolicy: policy,
      lines: [{ voucherId: posted.voucherId, lineId: posted.lineId }],
      changes: [
        {
          lineId: posted.lineId,
          expectedHeadRevision: 0,
          desiredAssignments: [
            { dimensionCode: department, valueCode: "0099", valueRevision: 1 },
            { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
          ],
          reason: "Synthetic reviewed reclassification",
        },
      ],
    },
    Dimensions.RestatementPlanView,
  );

  await failure(
    await request(book, `/dimensions/restatements/${plan.planId}/apply`, {
      method: "POST",
      body: JSON.stringify({ version: 1, digest: `sha256:${"b".repeat(64)}` }),
    }),
    409,
    "StaleDependency",
  );
});

test("NEXT-43 refuses a second restatement that does not name the current head revision", async () => {
  const { book, source } = await setup();

  await catalogue(book);

  const posted = await taggedPosting(book, source.id, "0012");
  const voucherId = posted.voucherId;
  const lineId = posted.lineId;

  const first = await post(
    book,
    "/dimensions/restatements",
    {
      analyticalScope: "management_department_view",
      reason: "Synthetic first review",
      dimensionPolicy: policy,
      lines: [{ voucherId, lineId }],
      changes: [
        {
          lineId: posted.lineId,
          expectedHeadRevision: 0,
          desiredAssignments: [
            { dimensionCode: department, valueCode: "0099", valueRevision: 1 },
            { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
          ],
          reason: "Synthetic first reclassification",
        },
      ],
    },
    Dimensions.RestatementPlanView,
  );

  await post(
    book,
    `/dimensions/restatements/${first.planId}/apply`,
    { version: 1, digest: first.digest },
    Dimensions.RestatementApplied,
  );

  // The head is now revision 1. A preview that still expects revision 0 is a
  // concurrent change, and the leaf refuses while preparing, so no plan a
  // reviewer could approve is ever sealed against a head that already moved.
  await failure(
    await request(book, "/dimensions/restatements", {
      method: "POST",
      body: JSON.stringify({
        analyticalScope: "management_department_view",
        reason: "Synthetic second review against a stale head",
        dimensionPolicy: policy,
        lines: [{ voucherId, lineId }],
        changes: [
          {
            lineId,
            expectedHeadRevision: 0,
            desiredAssignments: [
              { dimensionCode: department, valueCode: "0012", valueRevision: 1 },
              { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
            ],
            reason: "Synthetic stale reclassification",
          },
        ],
      }),
    }),
    409,
    "StaleDependency",
  );
});

test("NEXT-43 replays an identical restatement without recording a second revision", async () => {
  const { book, source } = await setup();

  await catalogue(book);

  const posted = await taggedPosting(book, source.id, "0012");
  const voucherId = posted.voucherId;
  const lineId = posted.lineId;

  const plan = await post(
    book,
    "/dimensions/restatements",
    {
      analyticalScope: "management_department_view",
      reason: "Synthetic review",
      dimensionPolicy: policy,
      lines: [{ voucherId, lineId }],
      changes: [
        {
          lineId: posted.lineId,
          expectedHeadRevision: 0,
          desiredAssignments: [
            { dimensionCode: department, valueCode: "0099", valueRevision: 1 },
            { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
          ],
          reason: "Synthetic reviewed reclassification",
        },
      ],
    },
    Dimensions.RestatementPlanView,
  );

  await post(
    book,
    `/dimensions/restatements/${plan.planId}/apply`,
    { version: 1, digest: plan.digest },
    Dimensions.RestatementApplied,
  );

  // A second, independently prepared plan asking for exactly the same set is a
  // replay: the head does not advance and no extra revision is recorded.
  const repeat = await post(
    book,
    "/dimensions/restatements",
    {
      analyticalScope: "management_department_view",
      reason: "Synthetic repeat review",
      dimensionPolicy: policy,
      lines: [{ voucherId, lineId }],
      changes: [
        {
          lineId: posted.lineId,
          expectedHeadRevision: 1,
          desiredAssignments: [
            { dimensionCode: department, valueCode: "0099", valueRevision: 1 },
            { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
          ],
          reason: "Synthetic repeat reclassification",
        },
      ],
    },
    Dimensions.RestatementPlanView,
  );

  const applied = await post(
    book,
    `/dimensions/restatements/${repeat.planId}/apply`,
    { version: 1, digest: repeat.digest },
    Dimensions.RestatementApplied,
  );

  expect(applied.appendedCount).toBe(0);
  expect(applied.replayedCount).toBe(1);
  expect(applied.lines[0]?.revisionId).toBe(1);

  const viewed = await decoded(
    await request(
      book,
      `/dimensions/lines/${voucherId}/${lineId}/classification?mode=reviewed&classificationCutoff=2099-12-31`,
    ),
    Dimensions.ClassificationView,
  );

  expect(viewed.revisionCount).toBe(1);
});

test("NEXT-43 refuses to restate a line that no retained posting carries", async () => {
  const { book } = await setup();

  await catalogue(book);

  await failure(
    await request(book, "/dimensions/restatements", {
      method: "POST",
      body: JSON.stringify({
        analyticalScope: "management_department_view",
        reason: "Synthetic review of a line that does not exist",
        dimensionPolicy: policy,
        lines: [{ voucherId: "voucher_absent", lineId: "line_absent" }],
        changes: [
          {
            lineId: "line_absent",
            expectedHeadRevision: 0,
            desiredAssignments: [
              { dimensionCode: department, valueCode: "0099", valueRevision: 1 },
              { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
            ],
            reason: "Synthetic reclassification of a missing line",
          },
        ],
      }),
    }),
    404,
    "NotFound",
  );
});

test("NEXT-43 shows the original and reviewed views side by side without moving money", async () => {
  const { book, source } = await setup();

  await catalogue(book);

  const posted = await taggedPosting(book, source.id, "0012");
  const voucherId = posted.voucherId;
  const lineId = posted.lineId;

  const plan = await post(
    book,
    "/dimensions/restatements",
    {
      analyticalScope: "management_department_view",
      reason: "Synthetic review",
      dimensionPolicy: policy,
      lines: [{ voucherId, lineId }],
      changes: [
        {
          lineId,
          expectedHeadRevision: 0,
          desiredAssignments: [
            { dimensionCode: department, valueCode: "0099", valueRevision: 1 },
            { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
          ],
          reason: "Synthetic reviewed reclassification",
        },
      ],
    },
    Dimensions.RestatementPlanView,
  );

  await post(
    book,
    `/dimensions/restatements/${plan.planId}/apply`,
    { version: 1, digest: plan.digest },
    Dimensions.RestatementApplied,
  );

  const view = await post(
    book,
    "/dimensions/restatements/view",
    {
      lines: [{ voucherId, lineId }],
      dimensionCodes: [department, project],
      classificationCutoff: "2099-12-31",
    },
    Dimensions.AnalyticalViewResult,
  );

  // Independent expectation, from the retained posting: the selection is one
  // debited line worth 12500 minor units.
  expect(view.unfilteredTotalMinor).toBe("12500");
  expect(view.lineCount).toBe(1);
  expect(view.lines[0]?.signedMinor).toBe("12500");

  // The original view still shows the original tag; the reviewed view shows the
  // new one. They are two views of the same money, not two amounts.
  const originalDepartment = view.originalTotals.find(
    (entry) => entry.dimensionCode === department && entry.valueCode === "0012",
  );

  const reviewedDepartment = view.reviewedTotals.find(
    (entry) => entry.dimensionCode === department && entry.valueCode === "0099",
  );

  expect(originalDepartment?.totalMinor).toBe("12500");
  expect(reviewedDepartment?.totalMinor).toBe("12500");

  // The original view has no 0099 bucket and the reviewed view has no 0012
  // bucket, so the reclassification really moved between buckets rather than
  // duplicating the money.
  expect(
    view.originalTotals.some(
      (entry) => entry.dimensionCode === department && entry.valueCode === "0099",
    ),
  ).toBe(false);
  expect(
    view.reviewedTotals.some(
      (entry) => entry.dimensionCode === department && entry.valueCode === "0012",
    ),
  ).toBe(false);

  // Conservation, per dimension and per view: every bucket of a dimension sums
  // to the unfiltered selection total. The Project dimension was never changed,
  // so its two views are identical.
  for (const totals of [view.originalTotals, view.reviewedTotals]) {
    for (const code of [department, project]) {
      const sum = totals
        .filter((entry) => entry.dimensionCode === code)
        .reduce((carry, entry) => carry + BigInt(entry.totalMinor), 0n);

      expect(String(sum), `${code} partition`).toBe("12500");
    }
  }

  const projectOriginal = view.originalTotals.find(
    (entry) => entry.dimensionCode === project && entry.valueCode === "Case-A",
  );

  const projectReviewed = view.reviewedTotals.find(
    (entry) => entry.dimensionCode === project && entry.valueCode === "Case-A",
  );

  expect(projectOriginal?.totalMinor).toBe(projectReviewed?.totalMinor);

  // A cutoff before the revision resolves the original view for both, because
  // the question "as at when" is part of the request.
  const earlier = await post(
    book,
    "/dimensions/restatements/view",
    {
      lines: [{ voucherId, lineId }],
      dimensionCodes: [department],
      classificationCutoff: "2020-01-01",
    },
    Dimensions.AnalyticalViewResult,
  );

  expect(earlier.reviewedTotals).toEqual(earlier.originalTotals);
});

test("the analytical view refuses a line selected twice instead of doubling it", async () => {
  const { book, source } = await setup();

  await catalogue(book);

  const posted = await taggedPosting(book, source.id, "0012");

  const response = await request(book, "/dimensions/restatements/view", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `${posted.voucherId}-dup` },
    body: JSON.stringify({
      lines: [
        { voucherId: posted.voucherId, lineId: posted.lineId },
        { voucherId: posted.voucherId, lineId: posted.lineId },
      ],
      dimensionCodes: [department],
      classificationCutoff: "2099-12-31",
    }),
  });

  await failure(response, 422, "InvalidJournal");
});

test("a second preview derives its before-state from the current review, not the original", async () => {
  const { book, source } = await setup();

  await catalogue(book);

  const posted = await taggedPosting(book, source.id, "0012");
  const selection = [{ voucherId: posted.voucherId, lineId: posted.lineId }];

  const first = await post(
    book,
    "/dimensions/restatements",
    {
      analyticalScope: "management_department_view",
      reason: "Synthetic first review A to B",
      dimensionPolicy: policy,
      lines: selection,
      changes: [
        {
          lineId: posted.lineId,
          expectedHeadRevision: 0,
          desiredAssignments: [
            { dimensionCode: department, valueCode: "0099", valueRevision: 1 },
            { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
          ],
          reason: "Synthetic A to B",
        },
      ],
    },
    Dimensions.RestatementPlanView,
  );

  expect(
    first.plan.totalsBefore.find(
      (entry) => entry.dimensionCode === department && entry.valueCode === "0012",
    )?.totalMinor,
  ).toBe("12500");

  await post(
    book,
    `/dimensions/restatements/${first.planId}/apply`,
    { version: 1, digest: first.digest },
    Dimensions.RestatementApplied,
  );

  const second = await post(
    book,
    "/dimensions/restatements",
    {
      analyticalScope: "management_department_view",
      reason: "Synthetic second review B to C",
      dimensionPolicy: policy,
      lines: selection,
      changes: [
        {
          lineId: posted.lineId,
          expectedHeadRevision: 1,
          desiredAssignments: [
            { dimensionCode: department, valueCode: "0012", valueRevision: 1 },
            { dimensionCode: project, valueCode: "Case-A", valueRevision: 1 },
          ],
          reason: "Synthetic B back to 0012",
        },
      ],
    },
    Dimensions.RestatementPlanView,
  );

  // The second preview calls B the before bucket: the current review, not A.
  expect(
    second.plan.totalsBefore.find(
      (entry) => entry.dimensionCode === department && entry.valueCode === "0099",
    )?.totalMinor,
  ).toBe("12500");
  expect(
    second.plan.totalsOriginal.find(
      (entry) => entry.dimensionCode === department && entry.valueCode === "0012",
    )?.totalMinor,
  ).toBe("12500");
});
