import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import * as History from "./onboarding-history-fixture.mjs";

const reviewOnly = process.argv.includes("--review-only");

const fullHistory = process.argv[3] === "--paper-history";

const sessionFile = process.argv[2];

if (
  !sessionFile ||
  basename(sessionFile) !== "session.json" ||
  !basename(dirname(sessionFile)).startsWith("openerp-paper-")
)
  throw new Error("Use the disposable launcher's private session.");

const scratch = dirname(sessionFile);

const session = JSON.parse(await readFile(sessionFile, "utf8"));

const databaseName = session.databaseName ?? "postgres";

if (!/^(postgres|openerp_ops_source_[a-z0-9_]{1,40})$/.test(databaseName))
  throw new Error("Only a disposable synthetic database is allowed.");

const origin = new URL(session.apiUrl);

if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1")
  throw new Error("Only the disposable local Worker is allowed.");

const scope = "/api/v1/entities/entity_synthetic/books/book_synthetic";

async function request(path, input, token = session.accessToken, allowMissing = false) {
  const response = await fetch(origin.origin + scope + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });

  const result = await response.json();

  if (allowMissing && response.status === 404 && result.code === "NotFound") return null;

  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);

  return result;
}

const starting = await request("/onboarding", undefined, session.accessToken, true);

if (!starting) await request("/onboarding", { path: "demo" });

const initial = await request("/onboarding/lifecycle");

if (initial.controls.length || initial.responsibilities || initial.snapshots.length)
  throw new Error("Use a fresh onboarding fixture.");

const { Client } = createRequire(new URL("../../apps/api/package.json", import.meta.url))("pg");

const pid = (await readFile(join(scratch, "pgdata/postmaster.pid"), "utf8")).split("\n");

const admin = new Client({
  host: scratch,
  port: Number(pid[3]),
  user: "postgres",
  database: databaseName,
});

const reviewerToken = randomBytes(32).toString("hex");

const reviewer = "actor_onboarding_reviewer";

const reviewerPassword = randomBytes(24).toString("hex");

const reviewerEmail = "sara-onboarding@example.test";

const release = {
  id: "paper_onboarding_synthetic_v1",
  jurisdiction: "QZ",
  family: "posting_eligibility",
  version: 1,
  checksum: `sha256:${"b".repeat(64)}`,
  applicability: {
    legalForms: [],
    accountingMethods: ["accrual"],
    vatRegistrations: [],
    payrollRegistrations: [],
  },
  requiredFactKinds: ["accounting_method"],
  requiredRoleKinds: ["commerce"],
  calculatorVersion: "synthetic-onboarding-v1",
  rounding: { mode: "half_up", scale: 2 },
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  sourceManifest: "Independent synthetic browser owner fixture",
  qualificationStatus: "reviewed",
  recordClasses: ["synthetic"],
};

await admin.connect();

try {
  if (fullHistory) {
    for (const account of History.chart)
      await admin.query(
        "insert into openerp.accounts(book_id,id,code,name) values('book_synthetic',$1,$2,$3) on conflict(book_id,id) do update set code=excluded.code,name=excluded.name",
        [account.id, account.code, account.name],
      );
  }

  await admin.query(
    "insert into openerp.actors(id,name) values($1,'Sara Lind') on conflict(id) do nothing",
    [reviewer],
  );
  await admin.query(
    "insert into openerp.memberships(book_id,actor_id,role) values('book_synthetic',$1,'operator') on conflict(book_id,actor_id) do nothing",
    [reviewer],
  );
  await admin.query(
    "insert into openerp.credentials(token_hash,actor_id,expires_at) values($1,$2,now()+interval '1 day')",
    [createHash("sha256").update(reviewerToken).digest("hex"), reviewer],
  );
  await admin.query(
    "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'QZ','posting_eligibility',1,$2,$3) on conflict(id) do nothing",
    [release.id, release.checksum, release],
  );
} finally {
  await admin.end();
}

const pgPassword = (await readFile(join(scratch, "pg-password"), "utf8")).trim();

await promisify(execFile)("bun", ["scripts/create-user.ts", reviewer], {
  cwd: new URL("../../apps/api", import.meta.url),
  env: {
    ...process.env,
    DATABASE_ADMIN_URL: `postgresql://postgres:${pgPassword}@127.0.0.1:${Number(pid[3])}/${databaseName}`,
    OPENERP_EMAIL: reviewerEmail,
    OPENERP_PASSWORD: reviewerPassword,
  },
});

const evidence = await request("/evidence", {
  title: "Independent synthetic browser fixture",
  mediaType: "text/plain",
  content: "Synthetic independent applicability and accounting source",
  origin: "Disposable onboarding browser owner fixture",
});

for (const [factKind, value] of [
  ["account_chart", "Synthetic reviewed chart"],
  ["jurisdiction", "QZ"],
  ["accounting_method", "accrual"],
  ["vat_registration", "not_registered"],
  ["asset_applicability", false],
  ["payroll_applicability", false],
  ["foreign_currency_applicability", false],
]) {
  const fact = await request("/company-facts", {
    factKind,
    value: { state: "known", value },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    supersedesId: null,
    evidence: [{ evidenceId: evidence.id, sha256: evidence.sha256 }],
    note: "Independent synthetic applicability",
  });

  await request(
    `/company-facts/${fact.id}/reviews`,
    {
      factRevisionId: fact.id,
      expectedDigest: fact.digest,
      result: "confirmed",
      rationale: "Independent synthetic review",
    },
    reviewerToken,
  );
}

await request("/company-role-bindings", {
  roleKind: "commerce",
  accountId: "account_clearing",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  supersedesId: null,
  reviewer,
  evidence: [{ evidenceId: evidence.id, sha256: evidence.sha256 }],
  note: "Synthetic retained binding",
});

const profile = await request("/company-activation-plans", {
  family: "posting_eligibility",
  recordClass: "synthetic",
  dates: {
    postingOn: "2026-09-30",
    taxPointOn: null,
    paymentOn: null,
    reportOn: null,
    taxPeriodOn: null,
  },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  reason: "Synthetic browser owner fixture",
});

const approved = await request(
  `/company-activation-plans/${profile.id}/approvals`,
  { planDigest: profile.digest },
  reviewerToken,
);

await request(`/company-activation-plans/${profile.id}/executions`, {
  planDigest: profile.digest,
  approvalId: approved.id,
});

const current = await request("/onboarding");

const setupCase = current.case ?? (await request("/onboarding", { path: "demo" }));

const configured = await request("/onboarding/revisions", {
  expectedRevision: setupCase.revision,
  configuration: {
    migrationDepth: "current_fiscal_year",
    incumbentSystem: fullHistory
      ? "Tidigare bokföringsprogram"
      : "Independent synthetic predecessor",
    dates: {
      historyStartsOn: "2026-01-01",
      historyEndsOn: "2026-09-30",
      detailStartsOn: "2026-01-01",
      openingOn: "2026-08-31",
      acceptanceStartsOn: "2026-09-01",
      acceptanceEndsOn: "2026-09-30",
      candidateLiveOn: "2026-10-01",
      provingPeriodEndsOn: "2026-10-31",
    },
  },
});

async function retain(filename, content, sourceSystem, category) {
  const occurrence = await request("/source-occurrences", {
    sourceSystem,
    sourceAccountId: "independent_book",
    occurrenceKey: randomUUID(),
    sourceRevision: "1",
    filename,
    mediaType: filename.endsWith(".csv") ? "text/csv" : "application/octet-stream",
    contentBase64: Buffer.from(content).toString("base64"),
  });

  if (category) await request("/onboarding/sources", { occurrenceId: occurrence.id, category });

  return occurrence;
}

async function control(asOf, amount) {
  if (fullHistory) {
    let values = History.september;

    if (asOf === "2025-12-31")
      values = Object.fromEntries(Object.keys(History.august).map((code) => [code, 0n]));

    if (asOf === "2026-08-31") values = History.august;

    const occurrence = await retain(
      `trial-balance-${asOf}.csv`,
      "kind,as_of,currency,source_identity,account_code,amount_minor\n" +
        Object.entries(values)
          .map(
            ([code, value]) =>
              `trial_balance,${asOf},SEK,account-${code},${code === "2999" ? "2890" : code},${value}\n`,
          )
          .join(""),
      "independent_trial_balance",
    );

    return request(
      "/onboarding/controls",
      {
        occurrenceId: occurrence.id,
        kind: "trial_balance",
        provenance: "Slutsaldo i tidigare bokföring",
      },
      reviewerToken,
    );
  }

  const occurrence = await retain(
    `trial-balance-${asOf}.csv`,
    `kind,as_of,currency,source_identity,account_code,amount_minor\ntrial_balance,${asOf},SEK,bank,1930,${amount}\ntrial_balance,${asOf},SEK,clearing,2999,${-BigInt(amount)}\n`,
    "independent_trial_balance",
  );

  return request(
    "/onboarding/controls",
    {
      occurrenceId: occurrence.id,
      kind: "trial_balance",
      provenance: "Independent synthetic control export",
    },
    reviewerToken,
  );
}

const source = await retain(
  fullHistory ? "fjallby_2026.se" : "owner-fixture.sie",
  fullHistory
    ? History.content
    : '#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2999 "Clearing"\n#IB 0 1930 0.00\n#UB 0 1930 0.00\n#IB 0 2999 0.00\n#UB 0 2999 0.00\n#VER A 1 20260831 "Synthetic bank movement"\n{\n#TRANS 1930 {} 8750.00\n#TRANS 2999 {} -8750.00\n}\n#VER A 2 20260929 "Synthetic opposite movement"\n{\n#TRANS 1930 {} -8750.00\n#TRANS 2999 {} 8750.00\n}\n',
  "synthetic_incumbent",
  "previous_books",
);

const preview = await request(`/source-occurrences/${source.id}/sie-previews`, {
  encoding: "utf-8",
});

const opening = await control("2025-12-31", "0");

const closing = await control("2026-09-30", "0");

const august = await control("2026-08-31", "875000");

if (fullHistory && !reviewOnly) {
  await request("/onboarding/account-mappings", {
    previewId: preview.id,
    expectedPreviewDigest: preview.digest,
    sourceAccount: "2999",
    accountId: "account_clearing",
    remember: true,
    expectedRevision: 0,
  });

  for (const { kind, code, items } of [
    { kind: "sales_open_items", code: "1510", items: History.openingCustomers },
    { kind: "purchase_open_items", code: "2440", items: History.openingSuppliers },
  ]) {
    const occurrence = await retain(
      `opening-${kind}.csv`,
      "kind,as_of,currency,source_identity,account_code,original_minor,outstanding_minor,state,counterparty_name\n" +
        items
          .map(
            ([identity, amount, name]) =>
              `${kind},2026-08-31,SEK,${identity},${code},${amount},${amount},unpaid,${name}\n`,
          )
          .join(""),
      "independent_invoice_export",
    );

    await request(
      "/onboarding/controls",
      { occurrenceId: occurrence.id, kind, provenance: "Öppna fakturor per 31 aug" },
      reviewerToken,
    );
  }
}

if (reviewOnly) {
  await writeFile(
    join(scratch, "onboarding-owner-fixture.json"),
    JSON.stringify(
      {
        reviewerToken,
        reviewer,
        reviewerEmail,
        reviewerPassword,
        source,
        preview,
        plan: null,
        staged: null,
        snapshot: null,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.info(
    JSON.stringify({
      fixture: "synthetic pre-import review",
      vouchers: preview.vouchers.length,
      posted: 0,
    }),
  );
  process.exit(0);
}

const plan = await request("/onboarding/import-plans", {
  expectedRevision: configured.revision,
  previewId: preview.id,
  expectedPreviewDigest: preview.digest,
  openingControlId: opening.id,
  closingControlId: closing.id,
  mappings: fullHistory
    ? History.mappings
    : [
        { sourceAccount: "1930", accountId: "account_bank" },
        { sourceAccount: "2999", accountId: "account_clearing" },
      ],
  rationale: "Retained independent controls establish initial history",
});

const staged = await request("/onboarding/imports", {
  expectedRevision: configured.revision,
  sourcePlanId: plan.id,
  expectedSourcePlanDigest: plan.digest,
});

await request("/onboarding/responsibilities", {
  expectedRevision: 0,
  assignments: {
    preparerId: fullHistory ? reviewer : "actor_operator",
    bookkeepingApproverId: fullHistory ? "actor_operator" : reviewer,
    paymentApproverId: "actor_operator",
    vatResponsibleId: reviewer,
    activationConfirmerIds: ["actor_operator", reviewer],
  },
});

const snapshot = await request("/onboarding/snapshots", {
  purpose: "opening",
  controlIds: [august.id],
  historicalRunIds: [staged.financialRun.id],
  closingCertificateId: null,
});

await writeFile(
  join(scratch, "onboarding-owner-fixture.json"),
  JSON.stringify(
    {
      reviewerToken,
      reviewer,
      reviewerEmail,
      reviewerPassword,
      source,
      preview,
      plan,
      staged,
      snapshot,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

console.info(
  JSON.stringify({
    fixture: "synthetic initial-import owners",
    vouchers: plan.voucherCount,
    posted: 0,
    openingSnapshot: snapshot.id,
    openingBlockers: snapshot.blockers,
  }),
);
