import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import * as Bank from "@open-erp/contracts/bank-workspace";
import * as Source from "@open-erp/contracts/source-intake";
import {
  apiDirectory,
  decoded,
  environment,
  failure,
  fixture,
  persisted,
  post,
  request,
  run,
} from "./support/fixtures";

test.each(["0000-06-15", "1900-02-29", "2025-02-29", "2026-04-31"])(
  "DF-06 human bank queries refuse non-calendar date %s before SQL",
  async (date) => {
    const book = await fixture();
    const before = await persisted(book);
    const query = new URLSearchParams({ startsOn: date, endsOn: date });

    await failure(await request(book, `/bank-workspace?${query}`), 422, "InvalidJournal");
    expect(await persisted(book)).toEqual(before);
  },
);

test("DF-06 real dates admit while uninterpreted invalid source bytes remain retained", async () => {
  const book = await fixture();
  const before = await persisted(book);
  const observations = [];

  for (const date of ["0001-01-01", "2000-02-29", "2024-02-29", "9999-12-31"]) {
    const query = new URLSearchParams({ startsOn: date, endsOn: date });

    const result = await decoded(
      await request(book, `/bank-workspace?${query}`),
      Bank.BankWorkspace,
    );

    expect(result.startsOn).toBe(date);
    expect(result.endsOn).toBe(date);
    observations.push({ date, admitted: true });
  }

  const bytes = Buffer.from(
    "date,description,amount\n0000-06-15,Uninterpreted original,1\n2025-02-29,Invalid leap day,2\n",
  );

  const source = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic_calendar",
      sourceAccountId: "uninterpreted_source",
      sourceRevision: "1",
      occurrenceKey: "invalid_calendar_original",
      filename: "calendar.csv",
      mediaType: "text/csv",
      contentBase64: bytes.toString("base64"),
    },
    Source.SourceOccurrence,
  );

  const retained = await decoded(
    await request(book, `/source-occurrences/${source.id}`),
    Source.SourceOccurrenceView,
  );

  expect(Buffer.from(retained.contentBase64, "base64")).toEqual(bytes);
  expect(await persisted(book)).toEqual(before);
  await writeFile(
    join(environment().artifacts, "df-06-calendar-admission.json"),
    JSON.stringify({ observations, source, originalPreserved: true, before }, null, 2),
  );
});

test("DF-06 the real Oxlint gate rejects another calendar round-trip copy", async () => {
  const directory = join(environment().scratch, "calendar-lint", "apps/api/src");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "calendar.ts");
  await writeFile(
    path,
    "export function admit(value: string) {\n  const parsed = new Date(`${value}T00:00:00Z`);\n\n  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;\n}\n",
  );

  await expect(
    run(
      "bun",
      [
        "run",
        "oxlint",
        "--threads",
        "2",
        "--config",
        resolve(apiDirectory, "../../.oxlintrc.json"),
        "--format",
        "json",
        path,
      ],
      {
        cwd: resolve(apiDirectory, "../.."),
      },
    ),
  ).rejects.toMatchObject({ stdout: expect.stringContaining("no-duplicate-calendar-date") });
});

test.each([
  [
    "packages/domain/src/values.ts",
    "parsed.toISOString().slice(0, 10) === value",
    "parsed: Date, value: string",
  ],
  [
    "apps/api/src/application/payroll/calculations.ts",
    "period.endsOn === last.toISOString().slice(0, 10)",
    "period: { endsOn: string }, last: Date",
  ],
  [
    "apps/api/src/application/vat/actual-return.ts",
    "start.toISOString().slice(0, 10) === endsOn",
    "start: Date, endsOn: string",
  ],
])(
  "DF-06 the native ratchet permits one comparison in %s but refuses a second",
  async (owner, comparison, parameters) => {
    const path = join(environment().scratch, "calendar-ratchet", owner);
    await mkdir(resolve(path, ".."), { recursive: true });
    const source = `export function compare(${parameters}) {\n  return ${comparison};\n}\n`;

    const arguments_ = [
      "run",
      "oxlint",
      "--threads",
      "2",
      "--config",
      resolve(apiDirectory, "../../.oxlintrc.json"),
      "--format",
      "json",
      path,
    ];

    const cwd = resolve(apiDirectory, "../..");

    await writeFile(path, source);
    await run("bun", arguments_, { cwd });
    await writeFile(
      path,
      source.replace("export function compare", "export function first") + source,
    );
    await expect(run("bun", arguments_, { cwd })).rejects.toMatchObject({
      stdout: expect.stringContaining("no-duplicate-calendar-date"),
    });
  },
);
