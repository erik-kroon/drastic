import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reports from "@open-erp/contracts/reports";
import * as Review from "@open-erp/contracts/accountant-review";
import * as Sie from "@open-erp/contracts/sie";
import * as Import from "@open-erp/contracts/sie-import";
import * as Intake from "@open-erp/contracts/source-intake";
import {
  decoded,
  environment,
  evidence,
  execute,
  fixture,
  journal,
  key,
  persisted,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

async function preview(book: BookFixture, bytes: Buffer, encoding: "ibm437" | "utf-8" = "ibm437") {
  const source = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic_sie",
      sourceAccountId: "Synthetic source book",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "account-codes.SE",
      mediaType: "application/octet-stream",
      contentBase64: bytes.toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  return post(
    book,
    `/source-occurrences/${source.id}/sie-previews`,
    { encoding },
    Import.SiePreview,
  );
}

// Independent controls: one 12500-minor debit and one 12500-minor credit.
// Codes are identifiers, including their zero prefixes, never amounts.
test.each(["1", "19301", "19301234", "0012"])(
  "DF-05 movement export and source staging preserve account code %s",
  async (code) => {
    const book = await fixture([{ id: "account_source", code, name: "Source account" }]);
    const source = await evidence(book);
    const input = journal(source.id);

    const proposal = await post(
      book,
      "/change-sets",
      {
        ...input,
        lines: input.lines.map((line, index) =>
          index === 0 ? { ...line, accountId: "account_source" } : line,
        ),
      },
      Accounting.ChangeSet,
    );

    await execute(book, proposal);

    const report = await post(
      book,
      "/report-snapshots",
      { kind: "trial_balance_v1", startsOn: "2026-01-01", endsOn: "2026-12-31" },
      Reports.ReportSnapshot,
    );

    const reviewed = await post(
      book,
      "/accountant-review-packs",
      {
        reportId: report.id,
        openingExplanation: "Synthetic zero opening",
        openingEvidenceIds: [source.id],
        accountantNotes: "Exact account-code interchange",
        excludedSources: [],
      },
      Review.ReviewPackView,
    );

    const exported = await post(
      book,
      "/sie-transfers",
      {
        packId: reviewed.pack.id,
        packDigest: reviewed.pack.digest,
        selection: "all_pack_movement_vouchers",
        legalName: "Synthetic interchange company",
        legalNameEvidenceId: source.id,
      },
      Sie.SieView,
    );

    if (!exported.artifact) throw new Error("The movement transfer must retain its bytes.");
    const bytes = Buffer.from(exported.artifact.contentBase64, "base64");
    expect(bytes.toString("latin1")).toContain(`#KONTO ${code} "Source account"`);
    expect(bytes.toString("latin1")).toContain(`#TRANS ${code} {} 125.00`);
    const destination = await fixture();
    const imported = await preview(destination, bytes);
    expect(imported.ready, JSON.stringify(imported.diagnostics)).toBe(true);
    expect(imported.vouchers[0]?.transactions.map((line) => [line.account, line.amount])).toEqual([
      [code, "125.00"],
      ["2999", "-125.00"],
    ]);

    // A movement transfer is not a complete opening ledger. Add independently
    // specified synthetic controls as a separately retained source, never claim
    // the original transfer supplied them or financially admit it here.
    const controls = Buffer.from(
      `#IB 0 ${code} 0.00\r\n#UB 0 ${code} 125.00\r\n#IB 0 2999 0.00\r\n#UB 0 2999 -125.00\r\n`,
    );

    const controlled = await preview(destination, Buffer.concat([bytes, controls]));

    const planInput = {
      digest: controlled.digest,
      mappings: [
        { sourceAccount: code, accountId: "account_bank" },
        { sourceAccount: "2999", accountId: "account_clearing" },
      ],
      openingControls: [
        {
          sourceAccount: code,
          year: "0",
          independentOpeningMinor: "0",
          independentClosingMinor: "12500",
          basis: "Synthetic independent debit control",
        },
        {
          sourceAccount: "2999",
          year: "0",
          independentOpeningMinor: "0",
          independentClosingMinor: "-12500",
          basis: "Synthetic independent credit control",
        },
      ],
      openItems: [],
      openItemControls: [],
      rationale: "Retain exact source codes through reviewed staging",
      openingPolicy: "unreconstructable_detail",
      sourceKind: "synthetic",
    };

    const plan = await post(
      destination,
      `/sie-previews/${controlled.id}/plans`,
      planInput,
      Import.SiePlan,
    );

    expect(plan.input.mappings[0]?.sourceAccount).toBe(code);

    const run = await post(
      destination,
      `/sie-plans/${plan.id}/runs`,
      { digest: plan.digest },
      Import.SieRunStart,
    );

    await post(
      destination,
      `/sie-runs/${run.id}/chunks`,
      { fence: run.fence, planDigest: plan.digest, firstOrdinal: 1 },
      Import.SieChunk,
    );

    const retained = await decoded(
      await request(destination, `/sie-runs/${run.id}`),
      Import.SieRun,
    );

    expect(retained.status).toBe("staged");
    expect((await persisted(destination))?.vouchers).toBe(0);

    for (const invalid of ["", "123456789", "+1930", "1930x", "１９３０"]) {
      const rejected = await request(destination, `/sie-previews/${controlled.id}/plans`, {
        method: "POST",
        body: JSON.stringify({
          ...planInput,
          mappings: [{ sourceAccount: invalid, accountId: "account_bank" }],
        }),
      });

      expect(rejected.status, invalid).toBe(400);
    }

    await writeFile(
      join(environment().artifacts, `df-05-${code}.json`),
      JSON.stringify({ exported, imported, controlled, plan, retained }, null, 2),
    );
  },
);

test("DF-05 malformed account declarations and transactions stay retained diagnostics", async () => {
  const book = await fixture();

  for (const invalid of ["123456789", "+1930", "1930x", "１９３０"]) {
    const content = `#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#KONTO ${invalid} "Invalid code"\n#VER "A" "1" 20260922\n{\n#TRANS ${invalid} {} 125.00\n#TRANS 2999 {} -125.00\n}\n`;
    const result = await preview(book, Buffer.from(content), "utf-8");
    expect(result.ready).toBe(false);
    expect(result.records.find((record) => record.tag === "KONTO")?.fields[0]).toBe(invalid);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "account_code")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "transaction")).toBe(true);
    expect(
      result.diagnostics.find((diagnostic) => diagnostic.code === "transaction")?.byteOffset,
    ).toBe(Buffer.from(content).indexOf(Buffer.from(`#TRANS ${invalid}`)));
  }
});
