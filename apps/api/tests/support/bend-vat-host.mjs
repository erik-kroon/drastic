import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { databaseLayer } from "../../src/db/connection.ts";
import {
  prepareActualReturn,
  getActualReturn,
  makeActualVatCalculator,
} from "../../src/application/vat/actual-return.ts";
import { calculateActualVat } from "../../../../jurisdictions/se/src/vat/actual.ts";
import { failure } from "../../src/application/failures.ts";
import { compiledEngine } from "../../../../verification/bend/authority/src/compiled-engine.mjs";
import { qualifiedService } from "../../../../verification/bend/authority/src/service.mjs";
import { createVatMonetaryPort } from "../../../../verification/bend/authority/src/vat-port.mjs";
import { SEMANTICS } from "../../../../verification/bend/authority/src/semantics.mjs";

const input = JSON.parse(process.env.OPENERP_HOST_INPUT);

const { book, evidenceId, vouchers } = input;

const scope = { entityId: book.entityId, bookId: book.bookId };

const artifact = await readFile(process.env.OPENERP_BEND_ARTIFACT);

const artifactDigest = "sha256:" + createHash("sha256").update(artifact).digest("hex");

assert.equal(artifactDigest, process.env.OPENERP_BEND_ARTIFACT_DIGEST);

const compiled = await import(`data:text/javascript;base64,${artifact.toString("base64")}`);

assert.equal(compiled.buildInfo.sourceTreeDigest, process.env.OPENERP_BEND_SOURCE_DIGEST);

const service = qualifiedService(compiledEngine(compiled.default, compiled.constructors), {
  status: "qualified-for-runtime",
  releaseId: "bend-host-test-only",
  runtimeId: `bun:${process.versions.bun}:${process.platform}:${process.arch}`,
  sourceTreeDigest: compiled.buildInfo.sourceTreeDigest,
  artifactDigest,
  manifestDigest: "sha256:" + "0".repeat(64),
  operations: ["money.round.v1", "vat.project.v1"],
  semantics: SEMANTICS,
});

const port = createVatMonetaryPort(service);

const calls = { round: 0, project: 0 };

const countedPort = {
  ...port,
  round(...args) {
    calls.round++;

    return port.round(...args);
  },
  project(value) {
    calls.project++;

    return port.project(value);
  },
};

const admin = new Client({ connectionString: input.adminUrl });

await admin.connect();

let assertions = 2;

const eq = (actual, expected) => {
  assert.deepEqual(actual, expected);
  assertions++;
};

const checks = [];

const run = (effect) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        databaseLayer({
          connectionString: Redacted.make(input.runtimeUrl),
          applicationName: "bend-host-qualification",
          connectTimeoutMs: 5000,
          statementTimeoutMs: 15000,
        }),
      ),
    ),
  );

const sealed = async (body) => {
  const result = await admin.query(
    "SELECT $1::jsonb || jsonb_build_object('digest',openerp.digest($1::jsonb)) AS body",
    [JSON.stringify(body)],
  );

  return result.rows[0].body;
};

const command = (key) => ({
  scope,
  idempotencyKey: key,
  input: {
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    periodEvidenceId: evidenceId,
    openingEvidenceId: evidenceId,
    controlOpenings: ["vat_output", "vat_input", "vat_settlement"].map((accountId) => ({
      accountId,
      signedMinor: "0",
    })),
    sourceCoverage: ["sales_ledger", "purchase_ledger"].map((family) => ({
      family,
      state: "current",
      evidenceId,
    })),
    rationale: "Synthetic qualification; no statutory filing",
  },
});

try {
  const releaseId = "release_" + book.bookId;

  const filing = {
    currency: "SEK",
    calculatorVersion: "vat-filing-actual-v1",
    filingUnitScale: 0,
    rounding: "toward_zero",
    rates: [{ rateId: "rate", numerator: "1", denominator: "4", salesBox: "10" }],
    mappingRules: [
      {
        mappingRuleId: "sale",
        treatment: "domestic_sale",
        rateId: "rate",
        basisBox: "05",
        inputBox: null,
      },
      {
        mappingRuleId: "purchase",
        treatment: "domestic_purchase",
        rateId: "rate",
        basisBox: null,
        inputBox: "48",
      },
    ],
    supportedTreatments: ["domestic_sale", "domestic_purchase"],
    requiredSourceFamilies: ["sales_ledger", "purchase_ledger"],
    sourceManifest: "Synthetic host qualification vector",
  };

  const release = {
    id: releaseId,
    jurisdiction: "SE",
    family: "vat",
    version: 1,
    checksum: "sha256:" + "1".repeat(64),
    applicability: {
      legalForms: [],
      accountingMethods: [],
      vatRegistrations: [],
      payrollRegistrations: [],
    },
    requiredFactKinds: ["vat_period"],
    requiredRoleKinds: [],
    calculatorVersion: "vat-filing-actual-v1",
    rounding: { mode: "toward_zero", scale: 0 },
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    sourceManifest: "Synthetic qualification",
    qualificationStatus: "reviewed",
    recordClasses: ["actual_company"],
    qualification: {
      releaseChecksum: "sha256:" + "1".repeat(64),
      primarySources: [
        {
          publisherUrl: "https://example.invalid/synthetic-rule-release",
          version: "synthetic-v1",
          sha256: "sha256:" + "2".repeat(64),
          retrievedAt: "2026-01-01T00:00:00.000Z",
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
        },
      ],
      reviewer: "Synthetic independent rule reviewer",
      reviewedAt: "2026-01-01T00:00:00.000Z",
      reviewArtifact: {
        artifactId: "artifact_synthetic_review",
        sha256: "sha256:" + "3".repeat(64),
      },
      examples: [
        {
          artifactId: "artifact_synthetic_example",
          sha256: "sha256:" + "4".repeat(64),
          releaseChecksum: "sha256:" + "1".repeat(64),
        },
      ],
      counterexamples: [
        {
          artifactId: "artifact_synthetic_counterexample",
          sha256: "sha256:" + "5".repeat(64),
          releaseChecksum: "sha256:" + "1".repeat(64),
        },
      ],
    },
    vat: filing,
  };

  await admin.query(
    "INSERT INTO openerp.rule_releases(id,jurisdiction,family,version,checksum,body) VALUES($1,'SE','vat',1,$2,$3)",
    [releaseId, release.checksum, release],
  );

  for (const [kind, value] of [
    ["jurisdiction", "SE"],
    ["vat_period", "monthly"],
  ]) {
    const id = kind + "_" + book.bookId;

    const body = await sealed({
      id,
      entityId: book.entityId,
      factKind: kind,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      recordedBy: book.actorId,
      value: { state: "known", value },
    });

    await admin.query(
      "INSERT INTO openerp.company_fact_revisions(entity_id,id,fact_kind,effective_from,effective_to,recorded_by,recorded_at,digest,body) VALUES($1,$2,$3,'2026-01-01','2026-12-31',$4,now(),$5,$6)",
      [book.entityId, id, kind, book.actorId, body.digest, body],
    );

    const review = await sealed({
      factRevisionId: id,
      reviewer: book.actorId,
      result: "confirmed",
    });

    await admin.query(
      "INSERT INTO openerp.company_fact_reviews(entity_id,fact_revision_id,reviewer,result,reviewed_at,digest,body) VALUES($1,$2,$3,'confirmed',now(),$4,$5)",
      [book.entityId, id, book.actorId, review.digest, review],
    );
  }

  const activation = await sealed({
    id: "activation",
    scope,
    family: "vat",
    ruleReleaseId: releaseId,
  });

  await admin.query(
    "INSERT INTO openerp.company_activations(book_id,id,family,rule_release_id,effective_from,activated_by,activated_at,digest,body) VALUES($1,'activation','vat',$2,'2026-01-01',$3,now(),$4,$5)",
    [book.bookId, releaseId, book.actorId, activation.digest, activation],
  );
  const profile = await sealed({ id: "controls" });
  await admin.query(
    "INSERT INTO openerp.vat_control_profiles(book_id,id,identity_key,role_evidence_id,body) VALUES($1,'controls','host-controls',$2,$3)",
    [book.bookId, evidenceId, profile],
  );

  for (const [role, accountId, code] of [
    ["output_vat_control", "vat_output", "2611"],
    ["input_vat_control", "vat_input", "2641"],
    ["vat_settlement_control", "vat_settlement", "2650"],
  ]) {
    await admin.query(
      "INSERT INTO openerp.vat_control_account_roles(book_id,profile_id,role,account_id,account_version,code,name,active) VALUES($1,'controls',$2,$3,1,$4,$3,true)",
      [book.bookId, role, accountId, code],
    );
  }

  for (const [index, treatment, netMinor, vatMinor] of [
    [0, "domestic_sale", "796", "199"],
    [1, "domestic_purchase", "404", "101"],
  ]) {
    const id = "fact_" + index;
    await admin.query(
      "INSERT INTO openerp.vat_fact_components(book_id,id,source_key,record_class) VALUES($1,$2,$2,'actual_company')",
      [book.bookId, id],
    );

    const body = await sealed({
      input: { treatment, taxPointOn: "2026-09-22", netMinor, vatMinor },
    });

    await admin.query(
      "INSERT INTO openerp.vat_fact_revisions(book_id,fact_id,revision,id,evidence_id,review_evidence_id,voucher_id,body) VALUES($1,$2,1,$2,$3,$3,$4,$5)",
      [book.bookId, id, evidenceId, vouchers[index], body],
    );
  }

  const prepared = await run(
    prepareActualReturn(book.token, command("host-capture"), makeActualVatCalculator(countedPort)),
  );

  eq(prepared.calculation.boxes, [
    { box: "05", kind: "primitive", exactMinor: "796", reportedMinor: "7", residualMinor: "96" },
    { box: "10", kind: "primitive", exactMinor: "199", reportedMinor: "1", residualMinor: "99" },
    { box: "48", kind: "primitive", exactMinor: "101", reportedMinor: "1", residualMinor: "1" },
    { box: "49", kind: "net", exactMinor: "98", reportedMinor: "0", residualMinor: "98" },
  ]);
  eq(prepared.calculation.filingReady, true);
  eq(prepared.calculation.monetaryRelease.artifactDigest, artifactDigest);
  assert.ok(calls.round >= 2 && calls.project === 1);
  assertions++;
  checks.push({ name: "current-owner-call-path", status: "passed" });

  const retained = await admin.query(
    "SELECT body FROM openerp.vat_actual_returns WHERE book_id=$1 AND id=$2",
    [book.bookId, prepared.id],
  );

  eq(retained.rows[0].body, prepared);
  await assert.rejects(
    admin.query(
      "UPDATE openerp.vat_actual_returns SET body=body || '{\"unexpected\":true}'::jsonb WHERE book_id=$1 AND id=$2",
      [book.bookId, prepared.id],
    ),
  );
  assertions++;
  checks.push({ name: "immutable-capture", status: "passed" });

  const broken = makeActualVatCalculator({
    ...port,
    project() {
      throw new Error("Candidate unavailable");
    },
  });

  eq(await run(prepareActualReturn(book.token, command("host-capture"), broken)), prepared);

  const refused = await run(
    prepareActualReturn(book.token, command("host-failure"), broken).pipe(Effect.result),
  );

  eq(refused._tag, "Failure");
  eq(refused.failure.code, "Unavailable");
  checks.push({ name: "no-typescript-fallback", status: "passed" });

  const stale = (basis) =>
    Effect.tryPromise({
      try: async () => {
        const calculation = calculateActualVat(basis, countedPort);
        await admin.query(
          "INSERT INTO openerp.company_family_memberships(book_id,family,membership_epoch,updated_at) VALUES($1,'vat',2,now()) ON CONFLICT(book_id,family) DO UPDATE SET membership_epoch=openerp.company_family_memberships.membership_epoch+1,updated_at=now()",
          [book.bookId],
        );

        return calculation;
      },
      catch: () => failure("InternalError"),
    });

  const staleResult = await run(
    prepareActualReturn(book.token, command("host-stale"), stale).pipe(Effect.result),
  );

  eq(staleResult._tag, "Failure");
  eq(staleResult.failure.code, "StaleDependency");

  const inventory = await admin.query(
    "SELECT count(*)::int AS total FROM openerp.vat_actual_returns WHERE book_id=$1",
    [book.bookId],
  );

  eq(inventory.rows[0].total, 1);

  const receipts = await admin.query(
    "SELECT count(*)::int AS total FROM openerp.command_receipts WHERE book_id=$1 AND key IN ('host-failure','host-stale')",
    [book.bookId],
  );

  eq(receipts.rows[0].total, 0);
  const view = await run(getActualReturn(book.token, { scope, id: prepared.id }));
  eq(view.saved, prepared);
  eq(view.currentness.basisCurrent, false);
  checks.push({ name: "changed-basis-refuses", status: "passed" });
  await writeFile(
    input.reportPath,
    JSON.stringify(
      {
        status: "passed",
        assertions,
        checks,
        operations: ["money.round.v1", "vat.project.v1"],
        hostRuntimeId: `bun:${process.versions.bun}:${process.platform}:${process.arch}`,
        runtimeBoundary: "Bun Effect workflow and real PostgreSQL; HTTP posting in workerd",
        artifactDigest,
        sourceTreeDigest: compiled.buildInfo.sourceTreeDigest,
        saved: prepared,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await admin.end();
}
