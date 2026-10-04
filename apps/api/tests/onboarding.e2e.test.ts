import { expect, test } from "vitest";
import * as Onboarding from "@open-erp/contracts/onboarding";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Profiles from "@open-erp/contracts/company-profiles";
import {
  database,
  decoded,
  evidence,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
} from "./support/fixtures";
import { saveSanitizedJourney } from "./assurance/database-support";

const dates = {
  historyStartsOn: null,
  historyEndsOn: null,
  detailStartsOn: null,
  openingOn: null,
  acceptanceStartsOn: null,
  acceptanceEndsOn: null,
  candidateLiveOn: null,
  provingPeriodEndsOn: null,
};

test("onboarding retains generic intent and source custody without activating a company", async () => {
  const book = await fixture();
  const other = await fixture();
  const before = await persisted(book);
  const commandKey = key();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({ path: "existing_company" }),
  };

  const created = await decoded(
    await request(book, "/onboarding", command),
    Onboarding.OnboardingCase,
  );

  expect(created.revision).toBe(1);
  expect(created.configuration.dates).toEqual(dates);
  expect(created.recordClass).toBe("actual_company");
  expect(
    await decoded(await request(book, "/onboarding", command), Onboarding.OnboardingCase),
  ).toEqual(created);
  await failure(
    await request(book, "/onboarding", { ...command, body: JSON.stringify({ path: "demo" }) }),
    409,
    "IdempotencyConflict",
  );
  await failure(
    await request(book, "/onboarding", { method: "POST", body: JSON.stringify({ path: "demo" }) }),
    409,
    "StaleDependency",
  );

  const configuration = {
    migrationDepth: "current_fiscal_year" as const,
    incumbentSystem: "Synthetic previous books",
    dates: {
      ...dates,
      openingOn: "2026-08-31",
      acceptanceStartsOn: "2026-09-01",
      acceptanceEndsOn: "2026-09-30",
      candidateLiveOn: "2026-10-01",
    },
  };

  const saved = await post(
    book,
    "/onboarding/revisions",
    { expectedRevision: 1, configuration },
    Onboarding.OnboardingCase,
  );

  expect(saved.id).toBe(created.id);
  expect(saved.revision).toBe(2);
  await failure(
    await request(book, "/onboarding/revisions", {
      method: "POST",
      body: JSON.stringify({ expectedRevision: 1, configuration }),
    }),
    409,
    "StaleDependency",
  );
  expect(
    (
      await decoded(await request(book, "/onboarding/revisions"), Onboarding.OnboardingHistory)
    ).items.map((item) => item.revision),
  ).toEqual([2, 1]);

  const occurrence = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "synthetic_incumbent",
      sourceAccountId: "synthetic_book",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "synthetic-opening.txt",
      mediaType: "application/octet-stream",
      contentBase64: Buffer.from(
        '#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2999 "Clearing"\n#IB 0 1930 0.00\n#UB 0 1930 125.00\n#IB 0 2999 0.00\n#UB 0 2999 -125.00\n#VER "A" "1" 20260922 "Synthetic movement"\n{\n#TRANS 1930 {} 125.00\n#TRANS 2999 {} -125.00\n}\n',
      ).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const source = await post(
    book,
    "/onboarding/sources",
    { occurrenceId: occurrence.id, category: "previous_books" },
    Onboarding.OnboardingSource,
  );

  expect(source.occurrence.id).toBe(occurrence.id);
  expect(source.occurrence.sha256).toBe(occurrence.sha256);
  expect(
    (
      await post(
        book,
        "/onboarding/sources",
        { occurrenceId: occurrence.id, category: "previous_books" },
        Onboarding.OnboardingSource,
      )
    ).id,
  ).toBe(source.id);
  await post(other, "/onboarding", { path: "existing_company" }, Onboarding.OnboardingCase);
  await failure(
    await request(other, "/onboarding/sources", {
      method: "POST",
      body: JSON.stringify({ occurrenceId: occurrence.id, category: "previous_books" }),
    }),
    404,
    "NotFound",
  );

  const workspace = await decoded(
    await request(book, "/onboarding"),
    Onboarding.OnboardingWorkspace,
  );

  expect(workspace.case.revision).toBe(2);
  expect(workspace.sources).toHaveLength(1);
  expect(workspace.cutover.ready).toBe(false);
  expect(workspace.cutover.authority).toBe("not_established");
  expect(workspace.qualification.every((item) => item.state !== "supported")).toBe(true);
  expect(workspace.profile.recordClass).toBe("actual_company");

  const preview = await post(
    book,
    `/source-occurrences/${occurrence.id}/sie-previews`,
    { encoding: "utf-8" },
    Sie.SiePreview,
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
      rationale: "Synthetic migration progress only",
      openingPolicy: "unreconstructable_detail",
      sourceKind: "synthetic",
    },
    Sie.SiePlan,
  );

  const run = await post(
    book,
    `/sie-plans/${plan.id}/runs`,
    { digest: plan.digest },
    Sie.SieRunStart,
  );

  const importing = await decoded(
    await request(book, "/onboarding"),
    Onboarding.OnboardingWorkspace,
  );

  expect(importing.imports).toEqual([
    {
      sourceRunId: run.id,
      sourcePlanId: plan.id,
      sourceKind: "synthetic",
      sourceState: "running",
      nextSourceOrdinal: 1,
      financialRunId: null,
      financialState: null,
      nextFinancialOrdinal: null,
    },
  ]);
  expect(importing.cutover.ready).toBe(false);
  expect(await persisted(book)).toEqual(before);
  await saveSanitizedJourney("onboarding-case", {
    created,
    saved,
    source,
    workspace,
    financialStateUnchanged: true,
  });
});

test("onboarding fact reads retain declared unknowns and separate reviewed revisions", async () => {
  const book = await fixture();
  const reviewer = await fixture();
  const source = await evidence(book);

  const fact = await post(
    book,
    "/company-facts",
    {
      factKind: "accounting_method",
      value: { state: "unknown" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Synthetic company has not supplied its accounting method",
    },
    Profiles.FactRevision,
  );

  const unreviewed = await decoded(await request(book, "/company-facts"), Profiles.CompanyFactPage);

  expect(unreviewed.items).toEqual([{ revision: fact, review: null }]);

  const framework = await post(
    book,
    "/company-facts",
    {
      factKind: "reporting_framework",
      value: { state: "known", value: "K3" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Synthetic K3 declaration, not product support",
    },
    Profiles.FactRevision,
  );

  const currency = await post(
    book,
    "/company-facts",
    {
      factKind: "base_currency",
      value: { state: "known", value: "EUR" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Synthetic EUR declaration, not a book currency change",
    },
    Profiles.FactRevision,
  );

  const admin = await database();

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
  } finally {
    await admin.end();
  }

  const review = await post(
    { ...book, token: reviewer.token },
    `/company-facts/${fact.id}/reviews`,
    {
      factRevisionId: fact.id,
      expectedDigest: fact.digest,
      result: "confirmed",
      rationale: "Confirm that the method remains explicitly unknown",
    },
    Profiles.FactReview,
  );

  const page = await decoded(await request(book, "/company-facts"), Profiles.CompanyFactPage);

  expect(page.items.find((item) => item.revision.id === fact.id)).toEqual({
    revision: fact,
    review,
  });
  expect(page.items.find((item) => item.revision.id === framework.id)?.revision.value).toEqual({
    state: "known",
    value: "K3",
  });
  expect(page.items.find((item) => item.revision.id === currency.id)?.revision.value).toEqual({
    state: "known",
    value: "EUR",
  });
  expect(
    (await decoded(await request(reviewer, "/company-facts"), Profiles.CompanyFactPage)).items,
  ).toEqual([]);
  await post(book, "/onboarding", { path: "existing_company" }, Onboarding.OnboardingCase);
  expect(
    (
      await decoded(await request(book, "/onboarding"), Onboarding.OnboardingWorkspace)
    ).qualification.every((item) => item.state !== "supported"),
  ).toBe(true);
  await saveSanitizedJourney("onboarding-fact-provenance", {
    page,
    confirmedUnknownIsNotQualified: true,
  });
});

test("onboarding refuses agent mutation, malformed dates and client completion assertions", async () => {
  const book = await fixture();
  await failure(
    await request(book, "/onboarding", {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}` },
      body: JSON.stringify({ path: "existing_company" }),
    }),
    403,
    "Forbidden",
  );
  await post(book, "/onboarding", { path: "existing_company" }, Onboarding.OnboardingCase);

  const response = await request(book, "/onboarding/revisions", {
    method: "POST",
    body: JSON.stringify({
      expectedRevision: 1,
      configuration: {
        migrationDepth: "current_fiscal_year",
        incumbentSystem: null,
        dates: { ...dates, openingOn: "2026-09-01", acceptanceStartsOn: "2026-09-01" },
      },
    }),
  });

  expect(response.status).toBe(400);
  expect(
    (
      await request(book, "/onboarding/revisions", {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: 1,
          configuration: { migrationDepth: null, incumbentSystem: null, dates },
          ready: true,
        }),
      })
    ).status,
  ).toBe(400);
  expect(
    (await decoded(await request(book, "/onboarding"), Onboarding.OnboardingWorkspace)).case
      .revision,
  ).toBe(1);
});
