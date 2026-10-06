import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Onboarding from "@open-erp/contracts/onboarding";
import {
  approve,
  database,
  createSession,
  decoded,
  environment,
  execution,
  failure,
  fixture,
  key,
  persisted,
  post,
  prepare,
  request,
} from "./support/fixtures";

test("case-free book responsibilities retain current authority without implying onboarding activation", async () => {
  const base = await fixture();
  const authorSession = await createSession(base);
  const book = { ...base, token: authorSession.token };
  const reviewer = await fixture();
  const foreign = await fixture();
  const admin = await database();
  const reviewerSession = await createSession(reviewer);
  const independent = { ...book, actorId: reviewer.actorId, token: reviewerSession.token };

  const assignments = {
    preparerId: book.actorId,
    bookkeepingApproverId: reviewer.actorId,
    paymentApproverId: reviewer.actorId,
    vatResponsibleId: book.actorId,
    activationConfirmerIds: [book.actorId, reviewer.actorId],
  };

  const before = await persisted(book);

  if (!before) throw new Error("Synthetic book financial controls missing");
  const refusals: Array<{ status: number; code: "Forbidden" | "StaleDependency" }> = [];

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
      [book.bookId, reviewer.actorId],
    );
    await failure(await request(book, "/onboarding"), 404, "NotFound");
    const firstKey = key();
    const firstInput = { expectedRevision: 0, assignments };

    const firstCommand = {
      method: "POST",
      headers: { "idempotency-key": firstKey },
      body: JSON.stringify(firstInput),
    };

    const first = await decoded(
      await request(book, "/onboarding/responsibilities", firstCommand),
      Onboarding.OnboardingResponsibilities,
    );

    expect(first.revision).toBe(1);
    expect(
      await decoded(
        await request(book, "/onboarding/responsibilities", firstCommand),
        Onboarding.OnboardingResponsibilities,
      ),
    ).toEqual(first);
    const secondKey = key();

    const secondInput = {
      expectedRevision: 1,
      assignments: { ...assignments, vatResponsibleId: reviewer.actorId },
    };

    const secondCommand = {
      method: "POST",
      headers: { "idempotency-key": secondKey },
      body: JSON.stringify(secondInput),
    };

    const second = await decoded(
      await request(book, "/onboarding/responsibilities", secondCommand),
      Onboarding.OnboardingResponsibilities,
    );

    expect(second.revision).toBe(2);
    expect(
      await decoded(
        await request(book, "/onboarding/responsibilities", secondCommand),
        Onboarding.OnboardingResponsibilities,
      ),
    ).toEqual(second);

    const refuse = async (
      actor: typeof book,
      input: typeof secondInput,
      status: number,
      code: "Forbidden" | "StaleDependency",
    ) => {
      const response = await request(actor, "/onboarding/responsibilities", {
        method: "POST",
        body: JSON.stringify(input),
      });

      await failure(response, status, code);
      refusals.push({ status: response.status, code });
      expect(await persisted(book)).toEqual(before);
    };

    await refuse(book, { ...secondInput, expectedRevision: 0 }, 409, "StaleDependency");
    const nextInput = { ...secondInput, expectedRevision: 2 };
    await refuse(
      { ...book, token: book.agentToken, actorId: book.agentId },
      nextInput,
      403,
      "Forbidden",
    );
    await refuse(
      book,
      { ...nextInput, assignments: { ...assignments, bookkeepingApproverId: foreign.actorId } },
      403,
      "Forbidden",
    );
    await admin.query("UPDATE openerp.identity_admissions SET enabled=false WHERE actor_id=$1", [
      reviewer.actorId,
    ]);

    try {
      await refuse(book, nextInput, 403, "Forbidden");
    } finally {
      await admin.query("UPDATE openerp.identity_admissions SET enabled=true WHERE actor_id=$1", [
        reviewer.actorId,
      ]);
    }

    await admin.query("DELETE FROM openerp.memberships WHERE book_id=$1 AND actor_id=$2", [
      book.bookId,
      reviewer.actorId,
    ]);

    try {
      await refuse(independent, nextInput, 403, "Forbidden");
    } finally {
      await admin.query(
        "INSERT INTO openerp.memberships(book_id,actor_id,role) VALUES($1,$2,'operator')",
        [book.bookId, reviewer.actorId],
      );
    }

    await failure(await request(book, "/onboarding"), 404, "NotFound");
    const plan = await prepare(book);
    const approval = await approve(independent, plan);

    const posted = await post(
      book,
      `/change-sets/${plan.id}/execute`,
      execution(plan, approval),
      Accounting.ExecutionReceipt,
    );

    const caseFreeAfter = await persisted(book);

    if (!caseFreeAfter) throw new Error("Posted synthetic book financial controls missing");
    expect(caseFreeAfter.vouchers).toBe(before.vouchers + 1);
    await failure(await request(book, "/onboarding"), 404, "NotFound");
    const nextPlan = await prepare(book, "8750");
    const nextApproval = await approve(independent, nextPlan);
    const approved = await persisted(book);
    const onboarding = await post(book, "/onboarding", { path: "demo" }, Onboarding.OnboardingCase);

    const response = await request(book, `/change-sets/${nextPlan.id}/execute`, {
      method: "POST",
      body: JSON.stringify(execution(nextPlan, nextApproval)),
    });

    await failure(response, 403, "ApprovalRequired");
    expect(await persisted(book)).toEqual(approved);

    const policies = (
      await admin.query(
        "SELECT body FROM openerp.onboarding_responsibilities WHERE book_id=$1 ORDER BY (body->>'revision')::int",
        [book.bookId],
      )
    ).rows;

    expect(policies.map((row) => row.body)).toEqual([first, second]);
    await writeFile(
      join(environment().artifacts, "book-responsibilities-public-proof.json"),
      JSON.stringify(
        {
          first,
          second,
          refusals,
          before,
          posted,
          caseFreeAfter,
          approved,
          onboarding,
          activationRefusal: response.status,
          policies,
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.end();
  }
});
