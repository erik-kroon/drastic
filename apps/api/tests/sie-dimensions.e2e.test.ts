import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Dimensions from "@open-erp/contracts/dimensions";
import * as Sie4E from "@open-erp/contracts/sie4e";
import { compareSie4E, renderSie4E } from "@open-erp/jurisdiction-se/sie4e";
import { expect, test } from "vitest";
import { parseSie } from "../src/application/sie-import-parser";
import {
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

async function posting(
  book: BookFixture,
  evidenceId: string,
  dated: string,
  tagged: boolean,
  department = assignment("Department", "0012", 'Räksmörgås "A"'),
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
                index === 0 ? [department, assignment("Project", "Case-A", "Projekt Å")] : [],
            })),
          }
        : {}),
    },
    Accounting.ChangeSet,
  );

  return execute(book, plan);
}

async function setup() {
  const book = await fixture();
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
  const parsed = parseSie(bytes, "ibm437");
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
  expect(exported.capture.rendererRelease.version).toBe("openerp-sie4e-v2");
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
    expect(compareSie4E(exported.capture, membership, parseSie(changed, "ibm437")).matched).toBe(
      false,
    );
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

test("SIE4E refuses dimensional openings without attaching a lossy artifact", async () => {
  const { book, source, input } = await setup();
  await catalogue(book);
  await posting(book, source.id, "2025-12-31", true);
  await failure(
    await request(book, "/sie-book-exports", { method: "POST", body: JSON.stringify(input) }),
    422,
    "UnsupportedProfile",
  );
});

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
