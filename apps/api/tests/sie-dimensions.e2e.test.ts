import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Dimensions from "@open-erp/contracts/dimensions";
import * as Sie4E from "@open-erp/contracts/sie4e";
import * as SieImport from "@open-erp/contracts/sie-import";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Historical from "@open-erp/contracts/historical-migration";
import { compareSie4E, renderSie4E } from "@open-erp/jurisdiction-se/sie4e";
import { expect, test } from "vitest";
import { parseSie } from "../src/application/sie-import-parser";
import {
  database,
  approve,
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

const dimensionCodes = ["Department", "Project"];

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

async function catalogue(book: BookFixture, name = 'Räksmörgås "A"') {
  for (const code of dimensionCodes) {
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
    await post(
      book,
      "/dimensions/values",
      {
        dimensionCode: code,
        code: code === "Department" ? "0012" : "Case-A",
        name: code === "Department" ? name : "Projekt Å",
        expectedRevision: 0,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        archived: false,
      },
      Dimensions.DimensionValueSaved,
    );
  }
}

async function preparePosting(
  book: BookFixture,
  evidenceId: string,
  dated: string,
  tagged: boolean,
  department = assignment("Department", "0012", 'Räksmörgås "A"'),
  creditTagged = false,
) {
  const input = journal(evidenceId, "12500");

  const plan = await post(
    book,
    "/change-sets",
    {
      ...input,
      postingDate: dated,
      accountingPeriodId: dated.startsWith("2025") ? "period_2025" : "period_2026",
      ...(tagged
        ? {
            dimensionPolicy: dimensionCodes.map((dimensionCode) => ({
              dimensionCode,
              requirement: "optional",
              fixedValueCode: null,
              fixedValueRevision: null,
              defaultValueCode: null,
            })),
            lines: input.lines.map((line, index) => ({
              ...line,
              originalDimensions:
                index === 0 || creditTagged
                  ? [department, assignment("Project", "Case-A", "Projekt Å")]
                  : [],
            })),
          }
        : {}),
    },
    Accounting.ChangeSet,
  );

  return plan;
}

async function posting(...args: Parameters<typeof preparePosting>) {
  return execute(args[0], await preparePosting(...args));
}

async function stagedSource(book: BookFixture) {
  const content =
    "#FLAGGA 0\r\n#FORMAT PC8\r\n#SIETYP 4\r\n#IB 0 1930 0.00\r\n#IB 0 2999 0.00\r\n#UB 0 1930 125.00\r\n#UB 0 2999 -125.00\r\n#VER A 1 20251231\r\n{\r\n#TRANS 1930 {} 125.00\r\n#TRANS 2999 {} -125.00\r\n}\r\n";

  const source = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic_sie_opening_controls",
      sourceAccountId: "Synthetic source book",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "opening.SE",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(content).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const preview = await post(
    book,
    `/source-occurrences/${source.id}/sie-previews`,
    { encoding: "ibm437" },
    SieImport.SiePreview,
  );

  const plan = await post(
    book,
    `/sie-previews/${preview.id}/plans`,
    {
      digest: preview.digest,
      mappings: [
        { sourceAccount: "1930", accountId: "account_bank" },
        { sourceAccount: "2999", accountId: "account_clearing" },
      ],
      openingControls: [
        {
          sourceAccount: "1930",
          year: "0",
          independentOpeningMinor: "0",
          independentClosingMinor: "12500",
          basis: "Synthetic independent control",
        },
        {
          sourceAccount: "2999",
          year: "0",
          independentOpeningMinor: "0",
          independentClosingMinor: "-12500",
          basis: "Synthetic independent control",
        },
      ],
      openItems: [],
      openItemControls: [],
      rationale: "Retain source before reviewing an opening set",
      openingPolicy: "unreconstructable_detail",
      sourceKind: "synthetic",
    },
    SieImport.SiePlan,
  );

  const run = await post(
    book,
    `/sie-plans/${plan.id}/runs`,
    { digest: plan.digest },
    SieImport.SieRunStart,
  );

  await post(
    book,
    `/sie-runs/${run.id}/chunks`,
    { fence: run.fence, planDigest: plan.digest, firstOrdinal: 1 },
    SieImport.SieChunk,
  );

  return plan;
}

async function setup(extraAccounts: Parameters<typeof fixture>[0] = []) {
  const book = await fixture(extraAccounts);
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

  const source = await evidence(book);

  return {
    book,
    source,
    input: {
      fiscalYearId: "fy_2026",
      asOf: "2026-12-31",
      legalName: "Synthetic SIE AB",
      organizationNumber: "555555-5555",
      legalNameEvidenceId: source.id,
      accountClassifications: [
        { accountId: "account_bank", accountClass: "balance_sheet" as const },
        { accountId: "account_clearing", accountClass: "balance_sheet" as const },
      ],
    },
  };
}

async function rows(book: BookFixture, id: string) {
  const page = await decoded(
    await request(book, `/sie-book-exports/${id}/rows`),
    Sie4E.Sie4ERowsPage,
  );

  expect(page.next).toBeNull();

  return page.items;
}

test("SIE4E preserves original dimension codes, labels and assignments in frozen bytes", async () => {
  const { book, source, input } = await setup();
  await posting(book, source.id, "2025-12-31", false);
  await catalogue(book);
  await posting(book, source.id, "2026-09-22", true);
  const before = await ledger(book);
  const idempotencyKey = key();

  const prepare = () =>
    request(book, "/sie-book-exports", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
    });

  const exported = await decoded(await prepare(), Sie4E.Sie4EView);
  expect(exported.artifact).not.toBeNull();

  if (exported.artifact === null) throw new Error("No verified SIE artifact");

  const bytes = Buffer.from(exported.artifact.contentBase64, "base64");
  const membership = await rows(book, exported.capture.id);
  const parsed = parseSie(bytes, "ibm437", "export_validation");
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.records.filter((record) => record.tag === "DIM").map((r) => r.fields)).toEqual([
    ["20", "Department"],
    ["21", "Project"],
  ]);
  expect(parsed.records.filter((record) => record.tag === "OBJEKT").map((r) => r.fields)).toEqual([
    ["20", "0012", 'Räksmörgås "A"'],
    ["21", "Case-A", "Projekt Å"],
  ]);
  expect(parsed.vouchers[0]?.transactions.map((line) => line.dimensions)).toEqual([
    "{20 0012 21 Case-A}",
    "{}",
  ]);
  expect(parsed.controls.map((control) => [control.kind, control.account, control.amount])).toEqual(
    [
      ["IB", "1930", "125.00"],
      ["IB", "2999", "-125.00"],
      ["UB", "1930", "250.00"],
      ["UB", "2999", "-250.00"],
    ],
  );
  expect(exported.capture.rendererRelease.version).toBe("openerp-sie4e-v3");
  expect(exported.artifact.destinationAcceptance).toBe("not_established");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(exported.artifact.sha256);
  expect(Buffer.from(renderSie4E(exported.capture, membership))).toEqual(bytes);
  expect(compareSie4E(exported.capture, membership, parsed).matched).toBe(true);

  expect(
    membership
      .filter((row) => row.kind === "line")
      .map((row) => row.originalDimensions?.map((entry) => entry.status)),
  ).toEqual([
    ["explicit", "explicit"],
    ["not_recorded_in_source", "not_recorded_in_source"],
  ]);

  const mutations = [
    (content: string) => content.replace(/^#OBJEKT[^\r\n]*\r\n/gm, ""),
    (content: string) => content.replace(/(#OBJEKT 20 "0012") [^\r\n]+/u, '$1 "Changed label"'),
    ...["{}", '{20 "Case-A" 21 "0012"}', '{20 "0012" 20 "0012"}', '{20 "unknown" 21 "Case-A"}'].map(
      (dimensions) => (content: string) => content.replace('{20 "0012" 21 "Case-A"}', dimensions),
    ),
  ];

  for (const mutate of mutations) {
    const changed = Buffer.from(mutate(bytes.toString("latin1")), "latin1");
    expect(changed).not.toEqual(bytes);
    expect(
      compareSie4E(exported.capture, membership, parseSie(changed, "ibm437", "export_validation"))
        .matched,
    ).toBe(false);
  }

  await post(
    book,
    "/dimensions/values",
    {
      dimensionCode: "Department",
      code: "0012",
      name: "Later name",
      expectedRevision: 1,
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
      archived: true,
    },
    Dimensions.DimensionValueSaved,
  );
  expect(await decoded(await prepare(), Sie4E.Sie4EView)).toEqual(exported);
  const recaptured = await post(book, "/sie-book-exports", input, Sie4E.Sie4EView);
  expect(recaptured.artifact?.contentBase64).toBe(exported.artifact.contentBase64);
  expect(await ledger(book)).toEqual(before);
  await failure(
    await request(book, "/sie-book-exports", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({ ...input, legalName: "Changed company" }),
    }),
    409,
    "IdempotencyConflict",
  );
  const foreign = await fixture();
  await failure(
    await request(foreign, `/sie-book-exports/${exported.capture.id}`),
    404,
    "NotFound",
  );
  await writeFile(join(environment().artifacts, "sie-dimensions.SE"), bytes);
  await writeFile(
    join(environment().artifacts, "sie-dimensions-journey.json"),
    JSON.stringify(
      { exported, membership, parsed, mutationsRejected: mutations.length, before },
      null,
      2,
    ),
  );

  await post(
    book,
    "/dimensions/values",
    {
      dimensionCode: "Department",
      code: "0012",
      name: "Later name",
      expectedRevision: 2,
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
      archived: false,
    },
    Dimensions.DimensionValueSaved,
  );
  await posting(book, source.id, "2026-09-23", true, {
    ...assignment("Department", "0012", "Later name"),
    valueRevision: 3,
  });
  await failure(
    await request(book, "/sie-book-exports", { method: "POST", body: JSON.stringify(input) }),
    422,
    "UnsupportedProfile",
  );
  expect(await decoded(await prepare(), Sie4E.Sie4EView)).toEqual(exported);
});

test.each(["prior_native_balance", "opening_set_voucher"])(
  "SIE4E preserves %s object balances without counting openings as movement",
  async (representation) => {
    const { book, source, input } = await setup();
    await catalogue(book);
    let openingVoucherId: string;

    if (representation === "prior_native_balance") {
      openingVoucherId = (await posting(book, source.id, "2025-12-31", true, undefined, true))
        .voucherId;
    } else {
      const sourcePlan = await stagedSource(book);
      const proposal = await preparePosting(book, source.id, "2026-02-01", true, undefined, true);
      await post(
        book,
        "/historical-bases",
        {
          fiscalYearId: "fy_2026",
          mode: "opening_set",
          cutoverOn: "2026-02-01",
          sourcePlanId: sourcePlan.id,
          sourceDigest: sourcePlan.digest,
          changeSetId: proposal.id,
          controls: [
            {
              accountId: "account_bank",
              signedMinor: "12500",
              basis: "Reviewed synthetic opening",
            },
            {
              accountId: "account_clearing",
              signedMinor: "-12500",
              basis: "Reviewed synthetic opening",
            },
          ],
          rationale: "A tagged opening set is distinct from current movements",
        },
        Historical.Basis,
      );
      const approval = await approve(book, proposal);

      const posted = await post(
        book,
        "/historical-bases/fy_2026/post",
        {
          planDigest: proposal.planDigest,
          approvalId: approval.id,
        },
        Historical.Basis,
      );

      if (!posted.voucherId) throw new Error("Opening set was not posted");

      openingVoucherId = posted.voucherId;

      await failure(
        await request(book, "/sie-book-exports", {
          method: "POST",
          body: JSON.stringify({ ...input, asOf: "2026-01-31" }),
        }),
        422,
        "UnsupportedProfile",
      );
    }

    // An opening-only object remains declared after its catalogue value is archived.
    await post(
      book,
      "/dimensions/values",
      {
        dimensionCode: "Department",
        code: "New",
        name: "Current department",
        expectedRevision: 0,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        archived: false,
      },
      Dimensions.DimensionValueSaved,
    );
    await posting(
      book,
      source.id,
      "2026-09-22",
      true,
      assignment("Department", "New", "Current department"),
    );
    await post(
      book,
      "/dimensions/values",
      {
        dimensionCode: "Department",
        code: "0012",
        name: "Archived current label",
        expectedRevision: 1,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        archived: true,
      },
      Dimensions.DimensionValueSaved,
    );
    const before = await ledger(book);
    const exported = await post(book, "/sie-book-exports", input, Sie4E.Sie4EView);

    if (!exported.artifact) throw new Error("Object-balance export has no artifact");

    const bytes = Buffer.from(exported.artifact.contentBase64, "base64");
    const parsed = parseSie(bytes, "ibm437", "export_validation");
    const membership = await rows(book, exported.capture.id);

    const controls = parsed.records
      .filter((entry) => entry.tag === "OIB" || entry.tag === "OUB")
      .map((entry) => [entry.tag, ...entry.fields]);

    expect(parsed.diagnostics).toEqual([]);
    expect(exported.capture.openingBasis.representation).toBe(representation);
    expect(parsed.vouchers).toHaveLength(1);
    expect(membership.filter((entry) => entry.kind === "opening_line")).toHaveLength(2);
    expect(
      membership
        .filter((entry) => entry.kind === "line")
        .some((entry) => entry.voucherId === openingVoucherId),
    ).toBe(false);
    expect(controls).toEqual([
      ["OIB", "0", "1930", "{20 0012}", "125.00"],
      ["OIB", "0", "1930", "{20 New}", "0.00"],
      ["OIB", "0", "1930", "{21 Case-A}", "125.00"],
      ["OIB", "0", "2999", "{20 0012}", "-125.00"],
      ["OIB", "0", "2999", "{21 Case-A}", "-125.00"],
      ["OUB", "0", "1930", "{20 0012}", "125.00"],
      ["OUB", "0", "1930", "{20 New}", "125.00"],
      ["OUB", "0", "1930", "{21 Case-A}", "250.00"],
      ["OUB", "0", "2999", "{20 0012}", "-125.00"],
      ["OUB", "0", "2999", "{21 Case-A}", "-125.00"],
    ]);
    expect(compareSie4E(exported.capture, membership, parsed).matched).toBe(true);
    expect(parseSie(bytes, "ibm437").ready).toBe(false);
    expect(await ledger(book)).toEqual(before);
    const line = '#OIB 0 1930 {20 "0012"} 125.00\r\n';

    for (const changed of [
      bytes.toString("latin1").replace(line, ""),
      bytes.toString("latin1").replace(line, line + line),
      bytes.toString("latin1").replace(line, line.replace("125.00", "126.00")),
      bytes.toString("latin1").replace(line, line.replace('"0012"', '"12"')),
      bytes
        .toString("latin1")
        .replace('#OUB 0 1930 {21 "Case-A"} 250.00', '#OUB 0 1930 {21 "Case-A"} 500.00'),
    ]) {
      expect(
        compareSie4E(
          exported.capture,
          membership,
          parseSie(Buffer.from(changed, "latin1"), "ibm437", "export_validation"),
        ).matched,
      ).toBe(false);
    }

    await posting(
      book,
      source.id,
      "2026-09-21",
      true,
      assignment("Department", "New", "Current department"),
    );

    const recovered = await post(
      book,
      `/sie-book-exports/${exported.capture.id}/render`,
      undefined,
      Sie4E.Sie4EView,
    );

    expect(recovered).toEqual(exported);
    await writeFile(join(environment().artifacts, `sie-${representation}.SE`), bytes);
    await writeFile(
      join(environment().artifacts, `sie-${representation}-journey.json`),
      JSON.stringify(
        { exported, membership, parsed, expectedObjectControls: controls, before },
        null,
        2,
      ),
    );
  },
);

test("SIE4E retains a failed CP437 capture without substituting its object label", async () => {
  const { book, source, input } = await setup();
  await posting(book, source.id, "2025-12-31", false);
  await catalogue(book, "Projekt €");
  await posting(book, source.id, "2026-09-22", true, assignment("Department", "0012", "Projekt €"));
  await failure(
    await request(book, "/sie-book-exports", { method: "POST", body: JSON.stringify(input) }),
    422,
    "UnsupportedProfile",
  );
  const list = await decoded(await request(book, "/sie-book-exports"), Sie4E.Sie4EList);
  expect(list.items).toHaveLength(1);
  const item = list.items[0];

  if (!item) throw new Error("Failed capture was not retained");

  expect(item.artifactAttached).toBe(false);
  await failure(
    await request(book, `/sie-book-exports/${item.id}/render`, { method: "POST" }),
    422,
    "UnsupportedProfile",
  );
  const saved = await decoded(await request(book, `/sie-book-exports/${item.id}`), Sie4E.Sie4EView);
  expect(saved.artifact).toBeNull();
});

test("SIE4E object controls preserve exact large opening amounts and zero closing balances", async () => {
  const { book, source, input } = await setup();
  await catalogue(book);
  const template = journal(source.id, "9007199254740993");

  const dimensionPolicy = dimensionCodes.map((dimensionCode) => ({
    dimensionCode,
    requirement: "required",
    fixedValueCode: null,
    fixedValueRevision: null,
    defaultValueCode: null,
  }));

  for (const opening of [true, false]) {
    const proposal = await post(
      book,
      "/change-sets",
      {
        ...template,
        eventKey: key(),
        dimensionPolicy,
        accountingPeriodId: opening ? "period_2025" : "period_2026",
        postingDate: opening ? "2025-12-31" : "2026-09-22",
        lines: template.lines.map((line) => ({
          ...line,
          debitMinor: opening ? line.debitMinor : line.creditMinor,
          creditMinor: opening ? line.creditMinor : line.debitMinor,
          originalDimensions: [
            assignment("Department", "0012", 'Räksmörgås "A"'),
            assignment("Project", "Case-A", "Projekt Å"),
          ],
        })),
      },
      Accounting.ChangeSet,
    );

    await execute(book, proposal);
  }

  const exported = await post(book, "/sie-book-exports", input, Sie4E.Sie4EView);

  if (!exported.artifact) throw new Error("Exact object controls missing");

  const parsed = parseSie(
    Buffer.from(exported.artifact.contentBase64, "base64"),
    "ibm437",
    "export_validation",
  );

  expect(
    parsed.records.filter((entry) => entry.tag === "OIB").map((entry) => entry.fields[3]),
  ).toEqual(["90071992547409.93", "90071992547409.93", "-90071992547409.93", "-90071992547409.93"]);
  expect(
    parsed.records.filter((entry) => entry.tag === "OUB").map((entry) => entry.fields[3]),
  ).toEqual(["0.00", "0.00", "0.00", "0.00"]);
  expect(
    compareSie4E(exported.capture, await rows(book, exported.capture.id), parsed).matched,
  ).toBe(true);
});

test("SIE4E refuses offsetting nominal object openings hidden by a zero account balance", async () => {
  const { book, source, input } = await setup([
    { id: "account_nominal", code: "3010", name: "Nominal" },
  ]);

  await catalogue(book);
  await post(
    book,
    "/dimensions/values",
    {
      dimensionCode: "Department",
      code: "Other",
      name: "Other department",
      expectedRevision: 0,
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
      archived: false,
    },
    Dimensions.DimensionValueSaved,
  );
  const template = journal(source.id, "10000");

  const proposal = await post(
    book,
    "/change-sets",
    {
      ...template,
      postingDate: "2025-12-31",
      accountingPeriodId: "period_2025",
      dimensionPolicy: dimensionCodes.map((dimensionCode) => ({
        dimensionCode,
        requirement: "optional",
        fixedValueCode: null,
        fixedValueRevision: null,
        defaultValueCode: null,
      })),
      lines: template.lines.map((line, index) => ({
        ...line,
        accountId: "account_nominal",
        originalDimensions: [
          index === 0
            ? assignment("Department", "0012", 'Räksmörgås "A"')
            : assignment("Department", "Other", "Other department"),
        ],
      })),
    },
    Accounting.ChangeSet,
  );

  await execute(book, proposal);
  await failure(
    await request(book, "/sie-book-exports", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        accountClassifications: [
          ...input.accountClassifications,
          { accountId: "account_nominal", accountClass: "nominal" },
        ],
      }),
    }),
    422,
    "UnsupportedProfile",
  );
});

test("SIE4E retains non-value opening assignment states without inventing objects", async () => {
  const { book, source, input } = await setup();
  await catalogue(book);
  const template = journal(source.id);

  const proposal = await post(
    book,
    "/change-sets",
    {
      ...template,
      postingDate: "2025-12-31",
      accountingPeriodId: "period_2025",
      dimensionPolicy: dimensionCodes.map((dimensionCode) => ({
        dimensionCode,
        requirement: "optional",
        fixedValueCode: null,
        fixedValueRevision: null,
        defaultValueCode: null,
      })),
      lines: template.lines.map((line, index) => ({
        ...line,
        originalDimensions:
          index === 0
            ? []
            : [
                {
                  ...assignment("Department", "0012", "Reviewed without allocation"),
                  status: "explicit_unassigned",
                  valueCode: null,
                  valueRevision: null,
                },
                {
                  ...assignment(
                    "Project",
                    "Case-A",
                    "Historical exemption supported by retained evidence",
                  ),
                  status: "historical_exemption",
                  valueCode: null,
                  valueRevision: null,
                  exemptionEvidenceId: source.id,
                },
              ],
      })),
    },
    Accounting.ChangeSet,
  );

  await execute(book, proposal);
  const exported = await post(book, "/sie-book-exports", input, Sie4E.Sie4EView);

  if (!exported.artifact) throw new Error("Opening-only capture was not rendered");

  const membership = await rows(book, exported.capture.id);
  expect(
    membership
      .filter((row) => row.kind === "opening_line")
      .map((row) => row.originalDimensions.map((entry) => entry.status)),
  ).toEqual([
    ["not_recorded_in_source", "not_recorded_in_source"],
    ["explicit_unassigned", "historical_exemption"],
  ]);

  const parsed = parseSie(
    Buffer.from(exported.artifact.contentBase64, "base64"),
    "ibm437",
    "export_validation",
  );

  expect(parsed.vouchers).toEqual([]);
  expect(parsed.records.filter((row) => ["OBJEKT", "OIB", "OUB"].includes(row.tag))).toEqual([]);
  expect(compareSie4E(exported.capture, membership, parsed).matched).toBe(true);
});

test.each(["openerp-sie4e-v1", "openerp-sie4e-v2"] as const)(
  "retained %s captures still resume without adopting object balances",
  async (version) => {
    const { book, source, input } = await setup();
    await posting(book, source.id, "2025-12-31", false);
    await posting(book, source.id, "2026-09-22", false);
    const current = await post(book, "/sie-book-exports", input, Sie4E.Sie4EView);
    const id = `siebook_legacy_${key().replaceAll("-", "")}`;

    const legacy = {
      ...current.capture,
      id,
      counts: { ...current.capture.counts },
      rendererRelease: { ...current.capture.rendererRelease, version },
      emittedRecords: {
        ...current.capture.emittedRecords,
        objectRecords:
          version === "openerp-sie4e-v1" ? "absent" : "original_transaction_assignments",
        recordProfile: current.capture.emittedRecords.recordProfile.filter(
          (tag) =>
            tag !== "#OIB" &&
            tag !== "#OUB" &&
            (version === "openerp-sie4e-v2" || (tag !== "#DIM" && tag !== "#OBJEKT")),
        ),
      },
    };

    delete legacy.counts.openingLines;

    if (version === "openerp-sie4e-v1") delete legacy.objectMap;

    const retained = (await rows(book, current.capture.id))
      .filter((row) => row.kind !== "opening_line")
      .map((row, index) => {
        const item = { ...row, ordinal: index + 1 };

        if (version === "openerp-sie4e-v1" && item.kind === "line") delete item.originalDimensions;

        return item;
      });

    const sourceBasis =
      version === "openerp-sie4e-v1"
        ? { rows: retained }
        : { rows: retained, objectMap: legacy.objectMap };

    const admin = await database();

    try {
      // Compatibility fixture only: install an old-format read-only capture over
      // the API-created ledger. No journal or financial receipt is seeded.
      await admin.query(
        `WITH captured AS (
      SELECT ($1::jsonb - 'digest') || jsonb_build_object('sourceDigest', openerp.digest($2::jsonb)) AS body
    ) INSERT INTO openerp.sie_book_exports
      (book_id, id, ordinal, fiscal_year_id, as_of, sequence, evidence_id, actor_id, body)
      SELECT $3, $4, 2, 'fy_2026', '2026-12-31', $5::bigint, $6, $7,
        body || jsonb_build_object('digest', openerp.digest(body)) FROM captured`,
        [
          JSON.stringify(legacy),
          JSON.stringify(sourceBasis),
          book.bookId,
          id,
          current.capture.ledgerBoundary,
          source.id,
          book.actorId,
        ],
      );

      for (const row of retained)
        await admin.query(
          `INSERT INTO openerp.sie_book_export_rows(book_id, export_id, ordinal, row_id, body)
        VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [book.bookId, id, row.ordinal, row.rowId, JSON.stringify(row)],
        );
    } finally {
      await admin.end();
    }

    const resumed = await post(book, `/sie-book-exports/${id}/render`, undefined, Sie4E.Sie4EView);

    if (!resumed.artifact) throw new Error("Legacy capture could not resume");

    const parsed = parseSie(
      Buffer.from(resumed.artifact.contentBase64, "base64"),
      "ibm437",
      "export_validation",
    );

    expect(resumed.capture.rendererRelease.version).toBe(version);
    expect(parsed.records.find((entry) => entry.tag === "PROGRAM")?.fields).toEqual([
      "OpenERP",
      version,
    ]);
    expect(parsed.records.some((entry) => entry.tag === "OIB" || entry.tag === "OUB")).toBe(false);
    expect(parsed.controls.map((entry) => entry.amount)).toEqual([
      "125.00",
      "-125.00",
      "250.00",
      "-250.00",
    ]);
    await posting(book, source.id, "2026-09-23", false);
    expect(await post(book, `/sie-book-exports/${id}/render`, undefined, Sie4E.Sie4EView)).toEqual(
      resumed,
    );
  },
);
