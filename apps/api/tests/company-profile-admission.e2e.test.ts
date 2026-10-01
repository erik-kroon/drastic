import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Profiles from "@open-erp/contracts/company-profiles";
import { expect, test } from "vitest";
import {
  database,
  decoded,
  environment,
  evidence,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

const path = "/company-activation-plans";

const input: typeof Profiles.PrepareCompanyActivation.Type = {
  family: "posting_eligibility",
  recordClass: "synthetic",
  dates: {
    postingOn: "2026-09-22",
    taxPointOn: null,
    paymentOn: null,
    reportOn: null,
    taxPeriodOn: null,
  },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  reason: "Synthetic authenticated activation admission",
};

async function prepared() {
  const book = await fixture();
  const independent = await fixture();
  const reviewer = { ...book, actorId: independent.actorId, token: independent.token };
  const source = await evidence(book);
  const admin = await database();

  const release = {
    id: "company_activation_synthetic_v1",
    jurisdiction: "ZZ",
    family: "posting_eligibility",
    version: 1,
    checksum: `sha256:${"a".repeat(64)}`,
    applicability: {
      legalForms: [],
      accountingMethods: ["accrual"],
      vatRegistrations: [],
      payrollRegistrations: [],
    },
    requiredFactKinds: ["accounting_method"],
    requiredRoleKinds: ["commerce"],
    calculatorVersion: "synthetic-company-activation-v1",
    rounding: { mode: "half_up", scale: 2 },
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    sourceManifest: "Synthetic ZZ jurisdiction fixture; no company or statutory claim",
    qualificationStatus: "reviewed",
    recordClasses: ["synthetic"],
  };

  try {
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await admin.query(
      "insert into openerp.rule_releases(id,jurisdiction,family,version,checksum,body) values($1,'ZZ','posting_eligibility',1,$2,$3) on conflict(id) do nothing",
      [release.id, release.checksum, release],
    );
  } finally {
    await admin.end();
  }

  const facts: Array<typeof Profiles.FactRevision.Type> = [];

  for (const declaration of [
    { factKind: "jurisdiction", value: { state: "known", value: "ZZ" } },
    { factKind: "accounting_method", value: { state: "known", value: "accrual" } },
  ]) {
    const fact = await post(
      book,
      "/company-facts",
      {
        ...declaration,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        supersedesId: null,
        evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
        note: "Synthetic retained company fact",
      },
      Profiles.FactRevision,
    );

    await post(
      reviewer,
      `/company-facts/${fact.id}/reviews`,
      {
        factRevisionId: fact.id,
        expectedDigest: fact.digest,
        result: "confirmed",
        rationale: "Independent synthetic fact review",
      },
      Profiles.FactReview,
    );
    facts.push(fact);
  }

  await post(
    book,
    "/company-role-bindings",
    {
      roleKind: "commerce",
      accountId: "account_clearing",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: null,
      reviewer: reviewer.actorId,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Synthetic reviewed account binding",
    },
    Profiles.RoleBinding,
  );

  return { book, reviewer, source, facts };
}

function canonical(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function counts(book: BookFixture) {
  const admin = await database();

  try {
    const result = await admin.query(
      `select
      (select count(*)::int from openerp.change_sets where book_id=$1) as plans,
      (select count(*)::int from openerp.company_activations where book_id=$1) as activations,
      (select count(*)::int from openerp.posting_group_receipts where book_id=$1) as receipts,
      (select count(*)::int from openerp.approval_consumptions where book_id=$1) as consumptions,
      (select count(*)::int from openerp.approvals where book_id=$1 and consumed_at is not null) as consumed,
      (select coalesce(max(membership_epoch),0)::text from openerp.company_family_memberships where book_id=$1) as epoch,
      (select count(*)::int from openerp.command_receipts where book_id=$1 and operation='execute_company_activation') as commands`,
      [book.bookId],
    );

    return { admission: result.rows[0], financial: await persisted(book) };
  } finally {
    await admin.end();
  }
}

async function refuse(
  book: BookFixture,
  endpoint: string,
  command: RequestInit,
  status: number,
  code: typeof Accounting.FailureCode.Type,
) {
  const response = await request(book, endpoint, command);

  const error = Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(
    await response.clone().text(),
  );

  await failure(response, status, code);

  return { status: response.status, error };
}

async function save(name: string, observed: unknown) {
  await writeFile(join(environment().artifacts, `${name}.json`), JSON.stringify(observed, null, 2));
}

async function approve(book: BookFixture, plan: typeof Profiles.CompanyActivationPlan.Type) {
  return post(
    book,
    `${path}/${plan.id}/approvals`,
    { planDigest: plan.digest },
    Profiles.CompanyActivationApproval,
  );
}

function execution(
  plan: typeof Profiles.CompanyActivationPlan.Type,
  approval: typeof Profiles.CompanyActivationApproval.Type,
  commandKey = key(),
) {
  return {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify({ planDigest: plan.digest, approvalId: approval.id }),
  };
}

test("company activation seals authenticated actor and database time, executes without journal and recovers unread response", async () => {
  const { book, reviewer } = await prepared();
  const admin = await database();
  const commandKey = key();

  const command = {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify(input),
  };

  try {
    const beforeTime = await admin.query<{ now: Date }>("select clock_timestamp() as now");
    const plan = await decoded(await request(book, path, command), Profiles.CompanyActivationPlan);
    const afterTime = await admin.query<{ now: Date }>("select clock_timestamp() as now");

    expect(plan.createdBy).toBe(book.actorId);
    expect(plan.schemaVersion).toBe(1);
    expect(plan.version).toBe(1);
    expect(plan.canonicalization).toBe("openerp-c14n-v1");
    expect(plan.owner).toBe("company_activation");
    expect(Date.parse(plan.createdAt)).toBeGreaterThanOrEqual(beforeTime.rows[0]!.now.getTime());
    expect(Date.parse(plan.createdAt)).toBeLessThanOrEqual(afterTime.rows[0]!.now.getTime());
    const { digest: sealed, ...body } = plan;
    const recomputed = `sha256:${createHash("sha256").update(canonical(body)).digest("hex")}`;

    expect(sealed).toBe(recomputed);
    expect(
      createHash("sha256")
        .update(canonical({ ...body, createdBy: reviewer.actorId }))
        .digest("hex"),
    ).not.toBe(sealed.slice(7));
    expect(
      createHash("sha256")
        .update(canonical({ ...body, createdAt: "2000-01-01T00:00:00.000Z" }))
        .digest("hex"),
    ).not.toBe(sealed.slice(7));

    const retained = await admin.query(
      "select created_by,plan,digest from openerp.change_sets where book_id=$1 and id=$2",
      [book.bookId, plan.id],
    );

    expect(retained.rows).toEqual([{ created_by: book.actorId, plan, digest: sealed }]);

    const replayedPlan = await decoded(
      await request(book, path, command),
      Profiles.CompanyActivationPlan,
    );

    expect(replayedPlan).toEqual(plan);

    const changed = await refuse(
      book,
      path,
      { ...command, body: JSON.stringify({ ...input, reason: "Changed command" }) },
      409,
      "IdempotencyConflict",
    );

    const actorMismatch = await refuse(reviewer, path, command, 409, "IdempotencyConflict");

    await save("company-activation-preparation", {
      input,
      plan,
      replayedPlan,
      databaseTime: { before: beforeTime.rows, after: afterTime.rows },
      retained: retained.rows,
      canonicalBody: canonical(body),
      recomputed,
      changed,
      actorMismatch,
    });

    const authorityResponse = await request(book, path, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        createdBy: reviewer.actorId,
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    });

    expect(authorityResponse.status).toBe(400);

    const authorityFields = {
      status: authorityResponse.status,
      error: Schema.decodeSync(Schema.JsonObject)(await authorityResponse.json()),
    };

    const approval = await approve(reviewer, plan);

    expect(approval.actorId).toBe(reviewer.actorId);
    const executeCommand = execution(plan, approval);
    const endpoint = `${path}/${plan.id}/executions`;
    const unread = await request(book, endpoint, executeCommand);

    expect(unread.status).toBe(200);

    const receipt = await decoded(
      await request(book, endpoint, executeCommand),
      Profiles.CompanyActivationReceipt,
    );

    const repeated = await decoded(
      await request(book, endpoint, executeCommand),
      Profiles.CompanyActivationReceipt,
    );

    expect(repeated).toEqual(receipt);
    expect(receipt.noFinancialEffect).toBe(true);
    expect(receipt.journalIds).toEqual([]);

    const activation = await decoded(
      await request(book, `/company-activations/${receipt.activationId}`),
      Profiles.CompanyActivation,
    );

    expect(activation.activatedBy).toBe(book.actorId);
    expect(activation.approvedDigest).toBe(plan.digest);
    expect(activation.factRevisionIds).toEqual(plan.witness.factRevisionIds);
    const observed = await counts(book);

    expect(observed).toEqual({
      admission: {
        plans: 1,
        activations: 1,
        receipts: 1,
        consumptions: 1,
        consumed: 1,
        epoch: "2",
        commands: 1,
      },
      financial: {
        sequence: "0",
        vouchers: 0,
        lines: 0,
        receipts: 0,
        outbox: 0,
        consumed: 1,
        counter: "0",
      },
    });
    await unread.body?.cancel();
    await save("company-activation-admission", {
      input,
      plan,
      replayedPlan,
      databaseTime: { before: beforeTime.rows, after: afterTime.rows },
      retained: retained.rows,
      canonicalBody: canonical(body),
      recomputed,
      changed,
      actorMismatch,
      authorityFields,
      approval,
      unreadStatus: unread.status,
      receipt,
      repeated,
      activation,
      observed,
    });
  } finally {
    await admin.end();
  }
}, 120000);

test.each(["stale_account", "revoked_approver", "revoked_executor"])(
  "company activation refuses %s without partial admission",
  async (scenario) => {
    const { book, reviewer } = await prepared();
    const plan = await post(book, path, input, Profiles.CompanyActivationPlan);
    const approval = await approve(reviewer, plan);
    const admin = await database();
    const before = await counts(book);

    try {
      if (scenario === "stale_account")
        await admin.query(
          "update openerp.accounts set active=false,version=version+1 where book_id=$1 and id='account_clearing'",
          [book.bookId],
        );

      if (scenario === "revoked_approver")
        await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
          book.bookId,
          reviewer.actorId,
        ]);

      if (scenario === "revoked_executor")
        await admin.query(
          "update openerp.credentials set revoked_at=clock_timestamp() where actor_id=$1",
          [book.actorId],
        );

      const status =
        scenario === "stale_account" ? 409 : scenario === "revoked_approver" ? 403 : 401;

      const code =
        scenario === "stale_account"
          ? "StaleDependency"
          : scenario === "revoked_approver"
            ? "ApprovalRequired"
            : "Unauthorized";

      const refusal = await refuse(
        book,
        `${path}/${plan.id}/executions`,
        execution(plan, approval),
        status,
        code,
      );

      const after = await counts(book);

      expect(after).toEqual(before);
      expect(after.admission).toEqual({
        plans: 1,
        activations: 0,
        receipts: 0,
        consumptions: 0,
        consumed: 0,
        epoch: "1",
        commands: 0,
      });
      await save(`company-activation-${scenario}`, { plan, approval, before, refusal, after });
    } finally {
      await admin.end();
    }
  },
  120000,
);

test("late activation receipt failure rolls back and the original command key recovers", async () => {
  const { book, reviewer } = await prepared();
  const plan = await post(book, path, input, Profiles.CompanyActivationPlan);
  const approval = await approve(reviewer, plan);
  const before = await counts(book);
  const admin = await database();
  const command = execution(plan, approval);
  const endpoint = `${path}/${plan.id}/executions`;
  let refusal;

  try {
    await admin.query(
      `create function openerp.e2e_activation_fault() returns trigger language plpgsql as $$ begin if new.book_id='${book.bookId}' and new.operation='execute_company_activation' then raise exception 'Synthetic activation receipt fault'; end if; return new; end $$`,
    );
    await admin.query(
      "create trigger e2e_activation_fault before insert on openerp.command_receipts for each row execute function openerp.e2e_activation_fault()",
    );
    refusal = await refuse(book, endpoint, command, 500, "InternalError");
    expect(await counts(book)).toEqual(before);
  } finally {
    await admin.query("drop trigger if exists e2e_activation_fault on openerp.command_receipts");
    await admin.query("drop function if exists openerp.e2e_activation_fault()");
    await admin.end();
  }

  const recovered = await decoded(
    await request(book, endpoint, command),
    Profiles.CompanyActivationReceipt,
  );

  const replayed = await decoded(
    await request(book, endpoint, command),
    Profiles.CompanyActivationReceipt,
  );

  const after = await counts(book);

  expect(replayed).toEqual(recovered);
  expect(after.admission).toEqual({
    plans: 1,
    activations: 1,
    receipts: 1,
    consumptions: 1,
    consumed: 1,
    epoch: "2",
    commands: 1,
  });
  await save("company-activation-rollback", {
    plan,
    approval,
    before,
    refusal,
    recovered,
    replayed,
    after,
  });
}, 120000);

test("confirmed superseding company facts remain ambiguous instead of choosing the newest", async () => {
  const { book, reviewer, source, facts } = await prepared();
  const original = facts.find((fact) => fact.factKind === "accounting_method");

  if (!original) throw new Error("Synthetic accounting-method fact missing.");

  const replacement = await post(
    book,
    "/company-facts",
    {
      factKind: "accounting_method",
      value: { state: "known", value: "cash" },
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      supersedesId: original.id,
      evidence: [{ evidenceId: source.id, sha256: source.sha256 }],
      note: "Preserve supersession ambiguity",
    },
    Profiles.FactRevision,
  );

  await post(
    reviewer,
    `/company-facts/${replacement.id}/reviews`,
    {
      factRevisionId: replacement.id,
      expectedDigest: replacement.digest,
      result: "confirmed",
      rationale: "Independent synthetic replacement review",
    },
    Profiles.FactReview,
  );
  const before = await counts(book);

  const refusal = await refuse(
    book,
    path,
    { method: "POST", body: JSON.stringify(input) },
    422,
    "UnsupportedProfile",
  );

  const after = await counts(book);

  expect(after).toEqual(before);
  expect(after.admission.plans).toBe(0);
  await save("company-activation-ambiguity", { original, replacement, before, refusal, after });
}, 120000);

test("concurrent activation approval and execution retain one winner and exact concurrent replay", async () => {
  const { book, reviewer } = await prepared();

  const plans = await Promise.all([
    post(book, path, input, Profiles.CompanyActivationPlan),
    post(book, path, input, Profiles.CompanyActivationPlan),
  ]);

  const approvals = await Promise.all(plans.map((plan) => approve(reviewer, plan)));
  const commands = plans.map((plan, index) => execution(plan, approvals[index]!));

  const responses = await Promise.all(
    plans.map((plan, index) => request(book, `${path}/${plan.id}/executions`, commands[index])),
  );

  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

  const winner = responses.findIndex((response) => response.status === 200);
  const loser = responses.findIndex((response) => response.status === 409);
  const receipt = await decoded(responses[winner]!, Profiles.CompanyActivationReceipt);

  const loserBody = Schema.decodeSync(Schema.fromJsonString(Accounting.AccountingError))(
    await responses[loser]!.clone().text(),
  );

  await failure(responses[loser]!, 409, "StaleDependency");
  expect(approvals.map((approval) => approval.actorId)).toEqual([
    reviewer.actorId,
    reviewer.actorId,
  ]);

  const replayed = await Promise.all(
    [0, 1].map(async () =>
      decoded(
        await request(book, `${path}/${plans[winner]!.id}/executions`, commands[winner]),
        Profiles.CompanyActivationReceipt,
      ),
    ),
  );

  expect(replayed).toEqual([receipt, receipt]);

  const observed = await counts(book);

  expect(observed).toEqual({
    admission: {
      plans: 2,
      activations: 1,
      receipts: 1,
      consumptions: 1,
      consumed: 1,
      epoch: "2",
      commands: 1,
    },
    financial: {
      sequence: "0",
      vouchers: 0,
      lines: 0,
      receipts: 0,
      outbox: 0,
      consumed: 1,
      counter: "0",
    },
  });
  await save("company-activation-concurrency", {
    plans,
    approvals,
    statuses: responses.map((response) => response.status),
    winner,
    loser,
    receipt,
    loserBody,
    replayed,
    observed,
  });
}, 120000);
