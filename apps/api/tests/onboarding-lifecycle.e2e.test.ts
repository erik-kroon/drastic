import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Historical from "@open-erp/contracts/historical-migration";
import { expect, test } from "vitest";
import * as Onboarding from "@open-erp/contracts/onboarding";
import * as Intake from "@open-erp/contracts/source-intake";
import { database, evidence, decoded, failure, fixture, key, post, request } from "./support/fixtures";
import { saveSanitizedJourney } from "./assurance/database-support";

test("retained onboarding controls derive exact money and refuse unqualified or stale acceptance", async () => {
  const book = await fixture();
  const other = await fixture();
  await post(book, "/onboarding", { path: "demo" }, Onboarding.OnboardingCase);
  await post(other, "/onboarding", { path: "demo" }, Onboarding.OnboardingCase);

  const original = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "independent_trial_balance",
      sourceAccountId: "control_book",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "opening.csv",
      mediaType: "text/csv",
      contentBase64: Buffer.from(
        "kind,as_of,currency,source_identity,account_code,amount_minor\ntrial_balance,2026-08-31,SEK,bank,1930,12500\ntrial_balance,2026-08-31,SEK,clearing,2999,-12500\n",
      ).toString("base64"),
    },
    Intake.SourceOccurrence,
  );

  const control = await post(
    book,
    "/onboarding/controls",
    {
      occurrenceId: original.id,
      kind: "trial_balance",
      provenance: "Independent synthetic control export",
    },
    Onboarding.OnboardingControl,
  );

  expect(control.facts.map((fact) => fact.amountMinor)).toEqual(["12500", "-12500"]);
  expect(control.sourceSha256).toBe(original.sha256);
  await failure(
    await request(other, "/onboarding/controls", {
      method: "POST",
      body: JSON.stringify({
        occurrenceId: original.id,
        kind: "trial_balance",
        provenance: "Wrong book",
      }),
    }),
    404,
    "NotFound",
  );

  const rejected = await request(book, "/onboarding/controls", {
    method: "POST",
    body: JSON.stringify({
      occurrenceId: original.id,
      kind: "trial_balance",
      provenance: "Attempted amount override",
      amountMinor: "0",
    }),
  });

  expect(rejected.ok).toBe(false);
  await failure(
    await request(book, "/onboarding/snapshots", {
      method: "POST",
      body: JSON.stringify({
        purpose: "opening",
        controlIds: [control.id],
        historicalRunIds: [],
        closingCertificateId: null,
      }),
    }),
    409,
    "StaleDependency",
  );

  const lifecycle = await decoded(
    await request(book, "/onboarding/lifecycle"),
    Onboarding.OnboardingLifecycle,
  );

  expect(lifecycle.controls).toHaveLength(1);
  expect(lifecycle.activation).toBeNull();
  expect(lifecycle.completion).toBeNull();
  await saveSanitizedJourney("onboarding-lifecycle-controls", { control, lifecycle });
});

test("current retained controls and named responsibility policy authorize exact lifecycle snapshots", async () => {
  const book = await fixture();
  const independent = await fixture();
  const reviewer = { ...book, actorId: independent.actorId, token: independent.token };
  const source = await evidence(book);
  const admin = await database();

  const release = {
    id: "onboarding_synthetic_posting_v1", jurisdiction: "QZ", family: "posting_eligibility", version: 1,
    checksum: `sha256:${"b".repeat(64)}`,
    applicability: { legalForms: [], accountingMethods: ["accrual"], vatRegistrations: [], payrollRegistrations: [] },
    requiredFactKinds: ["accounting_method"], requiredRoleKinds: ["commerce"],
    calculatorVersion: "synthetic-onboarding-v1", rounding: { mode: "half_up", scale: 2 },
    validFrom: "2026-01-01", validTo: "2026-12-31", sourceManifest: "Independent synthetic lifecycle fixture",
    qualificationStatus: "reviewed", recordClasses: ["synthetic"],
  };

  try {
    await admin.query("insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')", [book.bookId,reviewer.actorId]);
    await admin.query("insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'QZ','posting_eligibility',1,$2,$3) on conflict(id) do nothing", [release.id,release.checksum,release]);
  } finally { await admin.end(); }

  for (const declaration of [
    {factKind:"jurisdiction",value:{state:"known",value:"QZ"}},
    {factKind:"accounting_method",value:{state:"known",value:"accrual"}},
    {factKind:"vat_registration",value:{state:"known",value:"not_registered"}},
    {factKind:"asset_applicability",value:{state:"known",value:false}},
    {factKind:"payroll_applicability",value:{state:"known",value:false}},
    {factKind:"foreign_currency_applicability",value:{state:"known",value:false}},
  ]) {
    const fact = await post(book,"/company-facts",{...declaration,effectiveFrom:"2026-01-01",effectiveTo:null,supersedesId:null,
      evidence:[{evidenceId:source.id,sha256:source.sha256}],note:"Synthetic independently reviewed applicability"},Profiles.FactRevision);

    await post(reviewer,`/company-facts/${fact.id}/reviews`,{factRevisionId:fact.id,expectedDigest:fact.digest,result:"confirmed",rationale:"Independent synthetic review"},Profiles.FactReview);
  }

  await post(book,"/company-role-bindings",{roleKind:"commerce",accountId:"account_clearing",effectiveFrom:"2026-01-01",effectiveTo:null,
    supersedesId:null,reviewer:reviewer.actorId,evidence:[{evidenceId:source.id,sha256:source.sha256}],note:"Synthetic retained binding"},Profiles.RoleBinding);

  const profilePlan = await post(book,"/company-activation-plans",{family:"posting_eligibility",recordClass:"synthetic",
    dates:{postingOn:"2026-09-30",taxPointOn:null,paymentOn:null,reportOn:null,taxPeriodOn:null},effectiveFrom:"2026-01-01",effectiveTo:"2026-12-31",reason:"Synthetic onboarding profile"},Profiles.CompanyActivationPlan);

  const profileApproval = await post(reviewer,`/company-activation-plans/${profilePlan.id}/approvals`,{planDigest:profilePlan.digest},Profiles.CompanyActivationApproval);
  await post(book,`/company-activation-plans/${profilePlan.id}/executions`,{planDigest:profilePlan.digest,approvalId:profileApproval.id},Profiles.CompanyActivationReceipt);
  await post(book,"/onboarding",{path:"demo"},Onboarding.OnboardingCase);
  await post(book,"/onboarding/revisions",{expectedRevision:1,configuration:{migrationDepth:"current_fiscal_year",incumbentSystem:"Independent synthetic predecessor",dates:{
    historyStartsOn:"2026-01-01",historyEndsOn:"2026-09-30",detailStartsOn:"2026-01-01",openingOn:"2026-08-31",acceptanceStartsOn:"2026-09-01",acceptanceEndsOn:"2026-09-30",candidateLiveOn:"2026-10-01",provingPeriodEndsOn:"2026-10-31"}}},Onboarding.OnboardingCase);
  const original = await post(book,"/source-occurrences",{sourceSystem:"synthetic_incumbent",sourceAccountId:"incumbent_book",occurrenceKey:key(),sourceRevision:"1",filename:"unchanged.sie",mediaType:"application/octet-stream",contentBase64:Buffer.from('#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n#KONTO 1930 "Bank"\n#KONTO 2999 "Clearing"\n#IB 0 1930 0.00\n#UB 0 1930 0.00\n#IB 0 2999 0.00\n#UB 0 2999 0.00\n').toString("base64")},Intake.SourceOccurrence);
  await post(book,"/onboarding/sources",{occurrenceId:original.id,category:"previous_books"},Onboarding.OnboardingSource);
  const preview = await post(book,`/source-occurrences/${original.id}/sie-previews`,{encoding:"utf-8"},Sie.SiePreview);

  const plan = await post(book,`/sie-previews/${preview.id}/plans`,{digest:preview.digest,mappings:[{sourceAccount:"1930",accountId:"account_bank"},{sourceAccount:"2999",accountId:"account_clearing"}],
    openingControls:[{sourceAccount:"1930",year:"0",independentOpeningMinor:"0",independentClosingMinor:"0",basis:"Synthetic zero history"},{sourceAccount:"2999",year:"0",independentOpeningMinor:"0",independentClosingMinor:"0",basis:"Synthetic zero history"}],openItems:[],openItemControls:[],rationale:"Retained zero source history",openingPolicy:"unreconstructable_detail",sourceKind:"synthetic"},Sie.SiePlan);

  const sourceRun = await post(book,`/sie-plans/${plan.id}/runs`,{digest:plan.digest},Sie.SieRunStart);
  await post(book,"/historical-bases",{fiscalYearId:"fy_2026",mode:"full_history",cutoverOn:"2026-01-01",sourcePlanId:plan.id,sourceDigest:plan.digest,changeSetId:null,
    controls:[{accountId:"account_bank",signedMinor:"0",basis:"Synthetic independent zero"},{accountId:"account_clearing",signedMinor:"0",basis:"Synthetic independent zero"}],rationale:"Retained source zero opening"},Historical.Basis);
  const run = await post(book,`/sie-runs/${sourceRun.id}/financial-runs`,{fiscalYearId:"fy_2026",planDigest:plan.digest},Historical.RunStart);
  expect(run.status).toBe("posted");
  const policy = await post(book,"/onboarding/responsibilities",{expectedRevision:0,assignments:{preparerId:book.actorId,bookkeepingApproverId:reviewer.actorId,paymentApproverId:book.actorId,vatResponsibleId:reviewer.actorId,activationConfirmerIds:[book.actorId,reviewer.actorId]}},Onboarding.OnboardingResponsibilities);

  async function control(kind: typeof Onboarding.OnboardingControlKind.Type, asOf: string) {
    const rows = kind === "trial_balance" ? `trial_balance,${asOf},SEK,bank_zero,1930,0\ntrial_balance,${asOf},SEK,clearing_zero,2999,0\n` : `${kind},${asOf},SEK,zero_control,1930,0\n`;
    const occurrence = await post(book,"/source-occurrences",{sourceSystem:`independent_${kind}`,sourceAccountId:"independent_book",occurrenceKey:key(),sourceRevision:"1",filename:`${kind}.csv`,mediaType:"text/csv",contentBase64:Buffer.from("kind,as_of,currency,source_identity,account_code,amount_minor\n"+rows).toString("base64")},Intake.SourceOccurrence);

    return post(reviewer,"/onboarding/controls",{occurrenceId:occurrence.id,kind,provenance:"Independent original synthetic control"},Onboarding.OnboardingControl);
  }

  const openingControl = await control("trial_balance","2026-08-31");
  const endingControls = [];

  for (const kind of ["trial_balance","bank","sales_open_items","purchase_open_items","tax"] as const) endingControls.push(await control(kind,"2026-09-30"));

  async function capture(purpose: typeof Onboarding.OnboardingPurpose.Type, controlIds: string[]) {
    return post(book,"/onboarding/snapshots",{purpose,controlIds,historicalRunIds:[run.id],closingCertificateId:null},Onboarding.OnboardingSnapshot);
  }

  const opening = await capture("opening",[openingControl.id]);
  expect(opening.blockers).toEqual([]);
  expect(opening.comparisons.map((item)=>item.actualMinor)).toEqual(["0","0"]);
  await failure(await request(book,"/onboarding/decisions",{method:"POST",body:JSON.stringify({snapshotId:opening.id,expectedDigest:opening.digest,decision:{kind:"accept_opening",reason:"Wrong named human"}})}),403,"Forbidden");
  await post(reviewer,"/onboarding/decisions",{snapshotId:opening.id,expectedDigest:opening.digest,decision:{kind:"accept_opening",reason:"Independent opening accepted"}},Onboarding.OnboardingDecision);
  const zero = await capture("book_zero",endingControls.map((item)=>item.id));
  expect(zero.blockers).toEqual([]);
  await post(reviewer,"/onboarding/decisions",{snapshotId:zero.id,expectedDigest:zero.digest,decision:{kind:"accept_book_zero",reason:"Independent zero period accepted"}},Onboarding.OnboardingDecision);
  const delta = await capture("final_delta",endingControls.map((item)=>item.id));
  expect(delta.asOf).toBe("2026-09-30");
  expect(delta.blockers).toEqual([]);
  const acceptanceKey = key();
  const acceptance = {method:"POST",headers:{"idempotency-key":acceptanceKey},body:JSON.stringify({snapshotId:delta.id,expectedDigest:delta.digest,decision:{kind:"accept_final_delta",reason:"No changed final effects"}})};
  const accepted = await decoded(await request(reviewer,"/onboarding/decisions",acceptance),Onboarding.OnboardingDecision);
  await post(book,"/onboarding/responsibilities",{expectedRevision:policy.revision,assignments:{...policy.assignments,preparerId:reviewer.actorId}},Onboarding.OnboardingResponsibilities);
  await failure(await request(reviewer,"/onboarding/decisions",{...acceptance,headers:{"idempotency-key":key()}}),409,"StaleDependency");
  expect(await decoded(await request(reviewer,"/onboarding/decisions",acceptance),Onboarding.OnboardingDecision)).toEqual(accepted);
  await saveSanitizedJourney("onboarding-current-acceptance",{opening,zero,delta,accepted});
});
