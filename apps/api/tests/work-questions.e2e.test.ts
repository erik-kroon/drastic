import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/workspace";
import * as Source from "@open-erp/contracts/source-intake";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import * as Bank from "@open-erp/contracts/reconciliation";
import { supplierFixture } from "./support/supplier-review";
import {
  createSession,
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  persisted,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

async function questions(book: BookFixture, target: typeof Workspace.QuestionTarget.Type) {
  return post(book, "/workspace/questions/read", target, Workspace.WorkQuestionsView);
}

async function retain(
  book: BookFixture,
  text: string,
  mediaType: "text/plain" | "application/pdf",
) {
  return post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "question_e2e",
      sourceAccountId: "supplier_source",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: mediaType === "application/pdf" ? "answer.pdf" : "answer.txt",
      mediaType,
      contentBase64: Buffer.from(text).toString("base64"),
    },
    Source.SourceOccurrence,
  );
}

async function respondent(book: BookFixture) {
  const other = await fixture();
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'operator')",
      [book.bookId, other.actorId],
    );
  } finally {
    await admin.end();
  }

  return { ...book, actorId: other.actorId, token: (await createSession(other)).token };
}

test("a question follows one original through draft and review, and blocks posting until reviewed closure", async () => {
  const setup = await supplierFixture();
  const book = { ...setup.book, token: (await createSession(setup.book)).token };
  const answerer = await respondent(book);
  const before = await persisted(book);

  if (!before) throw new Error("Missing retained ledger observation");

  const original = await retain(
    book,
    "Independent supplier original: 10000 minor units",
    "text/plain",
  );

  await post(
    book,
    "/commerce/supplier-inbox",
    { occurrenceId: original.id, channel: "upload", messageIdentity: null },
    Inbox.SupplierInboxView,
  );
  const target = { kind: "document", recordId: original.id } as const;
  const initial = await questions(book, target);

  const asked = await post(
    book,
    "/workspace/questions",
    {
      target,
      expectedTargetRevision: initial.owner.revision,
      kind: "missing_evidence",
      question: "Please retain the supplier's supporting original",
      requestedFrom: answerer.actorId,
    },
    Workspace.WorkQuestionResult,
  );

  expect(asked.question.state).toBe("open");
  expect(asked.question.waitingOn).toBe(answerer.actorId);
  expect(asked.question.root).toEqual(initial.root);

  const source = await post(
    book,
    "/evidence",
    {
      title: "Supplier question original",
      mediaType: "application/json",
      origin: "Synthetic original review",
      content: JSON.stringify({
        kind: "supplier_invoice_source_v1",
        source: { occurrenceId: original.id, sha256: original.sha256, filename: original.filename },
      }),
    },
    Accounting.Evidence,
  );

  const draft = await post(
    book,
    `/commerce/supplier-inbox/${original.id}/review`,
    {
      draft: {
        draftKey: `question_${key()}`,
        content: { ...setup.content, sourceEvidenceId: source.id },
      },
      reviewReason: "Reviewed immutable original",
      reviewAttemptId: null,
    },
    Inbox.SupplierInboxReview,
  );

  const supplierTarget = { kind: "supplier", recordId: draft.draft.id } as const;
  const afterHandoff = await questions(book, supplierTarget);
  expect(afterHandoff.root).toEqual(initial.root);
  expect(afterHandoff.questions.map((item) => item.id)).toEqual([asked.question.id]);
  const queue = await decoded(await request(book, "/attention"), Workspace.AttentionPage);
  expect(queue.counts.open).toBe("1");
  expect(queue.items.find((item) => item.state === "open")?.questionSummary?.unresolved).toBe(1);
  expect(queue.items.find((item) => item.state === "open")?.questionRoot).toEqual(initial.root);

  const preparation = {
    profile: "synthetic-manual-supplier-v1",
    draftId: draft.draft.id,
    expectedRevision: draft.draft.revision,
    expectedDigest: draft.draft.digest,
    controlAccountId: "account_clearing",
    debitAccountId: "account_bank",
    accountingPeriodId: "period_2026",
    series: "A",
    reason: "Synthetic question-aware review",
    acknowledgeSyntheticOnly: true,
  };

  await failure(
    await request(book, "/commerce/supplier-acceptance-reviews", {
      method: "POST",
      body: JSON.stringify(preparation),
    }),
    422,
    "MissingEvidence",
  );

  const broken = await retain(answerer, "%PDF-1.7\nnot a PDF", "application/pdf");

  const brokenAnswer = await post(
    answerer,
    `/workspace/questions/${asked.question.id}/answers`,
    {
      target: supplierTarget,
      expectedTargetRevision: afterHandoff.owner.revision,
      expectedRevision: asked.question.revision,
      text: "The supplied copy is malformed",
      attachments: [{ occurrenceId: broken.id, sha256: broken.sha256 }],
    },
    Workspace.WorkQuestionResult,
  );

  expect(brokenAnswer.question.state).toBe("open");
  expect(brokenAnswer.question.waitingOn).toBe(book.actorId);
  expect(brokenAnswer.question.events.at(-1)?.attachments[0]?.availability).toBe("unreadable");
  await failure(
    await request(book, `/workspace/questions/${asked.question.id}/close`, {
      method: "POST",
      body: JSON.stringify({
        target: supplierTarget,
        expectedTargetRevision: afterHandoff.owner.revision,
        expectedRevision: brokenAnswer.question.revision,
        reason: "Received file is not proof of readable evidence",
      }),
    }),
    422,
    "MissingEvidence",
  );

  const valid = await retain(
    answerer,
    "Readable supporting original: independent 10000 minor units",
    "text/plain",
  );

  const answerInput = {
    target: supplierTarget,
    expectedTargetRevision: afterHandoff.owner.revision,
    expectedRevision: brokenAnswer.question.revision,
    text: "Correct readable original retained",
    attachments: [{ occurrenceId: valid.id, sha256: valid.sha256 }],
  };

  const answerKey = key();

  const answerResponse = () =>
    request(answerer, `/workspace/questions/${asked.question.id}/answers`, {
      method: "POST",
      headers: { "idempotency-key": answerKey },
      body: JSON.stringify(answerInput),
    });

  const answered = await decoded(await answerResponse(), Workspace.WorkQuestionResult);
  expect(await decoded(await answerResponse(), Workspace.WorkQuestionResult)).toEqual(answered);
  expect(answered.question.state).toBe("answered");
  expect(answered.question.waitingOn).toBe(book.actorId);
  expect(answered.question.events).toHaveLength(3);
  await failure(
    await request(book, "/commerce/supplier-acceptance-reviews", {
      method: "POST",
      body: JSON.stringify(preparation),
    }),
    422,
    "MissingEvidence",
  );
  expect(await persisted(book)).toEqual(before);

  const closed = await post(
    book,
    `/workspace/questions/${asked.question.id}/close`,
    {
      target: supplierTarget,
      expectedTargetRevision: afterHandoff.owner.revision,
      expectedRevision: answered.question.revision,
      reason: "Reviewed the retained answer and unchanged original",
    },
    Workspace.WorkQuestionResult,
  );

  expect(closed.question.state).toBe("closed");
  expect(closed.question.events).toHaveLength(4);

  const review = await post(
    book,
    "/commerce/supplier-acceptance-reviews",
    preparation,
    Acceptance.SupplierAcceptanceReview,
  );

  await failure(
    await request(book, `/change-sets/${review.postingPlan.id}/approvals`, {
      method: "POST",
      body: JSON.stringify({ version: 1, planDigest: review.postingPlan.planDigest }),
    }),
    403,
    "ApprovalRequired",
  );
  await failure(
    await request(book, `/change-sets/${review.postingPlan.id}/execute`, {
      method: "POST",
      body: JSON.stringify({
        version: 1,
        planDigest: review.postingPlan.planDigest,
        approvalId: "native_owner_required",
      }),
    }),
    403,
    "ApprovalRequired",
  );
  expect(await persisted(book)).toEqual(before);
  const journalTarget = { kind: "journal", recordId: review.postingPlan.id } as const;
  const reviewQuestions = await questions(book, journalTarget);
  expect(reviewQuestions.root).toEqual(initial.root);
  expect(reviewQuestions.questions[0]?.state).toBe("closed");
  const grantInput = { version: 1, digest: review.digest, acknowledgeSyntheticOnly: true };

  const grant = await post(
    book,
    `/commerce/supplier-acceptance-reviews/${review.id}/approvals`,
    grantInput,
    Acceptance.SupplierAcceptanceApproval,
  );

  const later = await post(
    book,
    "/workspace/questions",
    {
      target: journalTarget,
      expectedTargetRevision: reviewQuestions.owner.revision,
      kind: "clarification",
      question: "Confirm the reviewed treatment before execution",
      requestedFrom: answerer.actorId,
    },
    Workspace.WorkQuestionResult,
  );

  await failure(
    await request(book, `/commerce/supplier-acceptance-reviews/${review.id}/execute`, {
      method: "POST",
      body: JSON.stringify({ ...grantInput, approvalId: grant.id }),
    }),
    422,
    "MissingEvidence",
  );
  await failure(
    await request(book, `/commerce/supplier-acceptance-reviews/${review.id}/approvals`, {
      method: "POST",
      body: JSON.stringify(grantInput),
    }),
    422,
    "MissingEvidence",
  );
  expect(await persisted(book)).toEqual(before);

  const lastAnswer = await post(
    answerer,
    `/workspace/questions/${later.question.id}/answers`,
    {
      target: journalTarget,
      expectedTargetRevision: reviewQuestions.owner.revision,
      expectedRevision: later.question.revision,
      text: "Reviewed treatment confirmed",
      attachments: [],
    },
    Workspace.WorkQuestionResult,
  );

  await post(
    book,
    `/workspace/questions/${later.question.id}/close`,
    {
      target: journalTarget,
      expectedTargetRevision: reviewQuestions.owner.revision,
      expectedRevision: lastAnswer.question.revision,
      reason: "Reviewed confirmation before execution",
    },
    Workspace.WorkQuestionResult,
  );
  const executeKey = key();
  const executePath = `/commerce/supplier-acceptance-reviews/${review.id}/execute`;
  const executeInput = { ...grantInput, approvalId: grant.id };

  const executeRequest = () =>
    request(book, executePath, {
      method: "POST",
      headers: { "idempotency-key": executeKey },
      body: JSON.stringify(executeInput),
    });

  const receipt = await decoded(await executeRequest(), Acceptance.SupplierAcceptanceReceipt);
  expect(await decoded(await executeRequest(), Acceptance.SupplierAcceptanceReceipt)).toEqual(
    receipt,
  );
  const completedQuestions = await questions(book, target);
  expect(completedQuestions.owner.completed).toBe(true);
  expect(completedQuestions.questions.every((question) => question.state === "closed")).toBe(true);
  await failure(
    await request(book, `/workspace/questions/${asked.question.id}/close`, {
      method: "POST",
      body: JSON.stringify({
        target,
        expectedTargetRevision: completedQuestions.owner.revision,
        expectedRevision: closed.question.revision,
        reason: "Fresh change after native posting must remain sealed",
      }),
    }),
    409,
    "AlreadyPosted",
  );

  const afterPosting = await persisted(book);

  if (!afterPosting) throw new Error("Missing posted ledger observation");
  expect(afterPosting.vouchers).toBe(before.vouchers + 1);
  expect(afterPosting.receipts).toBe(before.receipts + 1);
  await writeFile(
    join(environment().artifacts, "work-question-original-handoff.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        root: initial.root,
        original,
        draftId: draft.draft.id,
        reviewId: review.id,
        question: closed.question,
        unresolvedQuestionId: later.question.id,
        ledgerUnchangedBeforeClosure: true,
        receipt,
        beforePosting: before,
        afterPosting,
        countOpen: queue.counts.open,
      },
      null,
      2,
    ),
  );
});

test("question ownership, hash, target revision and concurrent question revisions refuse stale or foreign writes", async () => {
  const local = await supplierFixture();
  const book = { ...local.book, token: (await createSession(local.book)).token };
  const answerer = await respondent(book);
  const original = await retain(book, "Question root", "text/plain");
  await post(
    book,
    "/commerce/supplier-inbox",
    { occurrenceId: original.id, channel: "upload", messageIdentity: null },
    Inbox.SupplierInboxView,
  );
  const target = { kind: "document", recordId: original.id } as const;
  const view = await questions(book, target);

  const asked = await post(
    book,
    "/workspace/questions",
    {
      target,
      expectedTargetRevision: view.owner.revision,
      kind: "clarification",
      question: "Which treatment applies?",
      requestedFrom: answerer.actorId,
    },
    Workspace.WorkQuestionResult,
  );

  const attachment = await retain(book, "Scoped supporting original", "text/plain");
  const foreign = await fixture();
  const foreignAttachment = await retain(foreign, "Foreign original", "text/plain");

  const input = {
    target,
    expectedTargetRevision: view.owner.revision,
    expectedRevision: asked.question.revision,
    text: "Qualified answer",
    attachments: [],
  };

  const answerPath = `/workspace/questions/${asked.question.id}/answers`;
  await failure(
    await request(answerer, answerPath, {
      method: "POST",
      body: JSON.stringify({ ...input, text: "   " }),
    }),
    422,
    "InvalidJournal",
  );

  await failure(
    await request(answerer, answerPath, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        attachments: [{ occurrenceId: attachment.id, sha256: `sha256:${"0".repeat(64)}` }],
      }),
    }),
    422,
    "MissingEvidence",
  );
  await failure(
    await request(answerer, answerPath, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        attachments: [{ occurrenceId: foreignAttachment.id, sha256: foreignAttachment.sha256 }],
      }),
    }),
    404,
    "NotFound",
  );
  await failure(
    await request(answerer, answerPath, {
      method: "POST",
      body: JSON.stringify({
        ...input,
        expectedTargetRevision: `sha256:${"0".repeat(64)}`,
      }),
    }),
    409,
    "StaleDependency",
  );

  const responses = await Promise.all(
    [0, 1].map(() =>
      request(answerer, answerPath, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  );

  expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([
    200, 409,
  ]);

  for (const response of responses) {
    if (response.status === 409) await failure(response, 409, "StaleDependency");
    else await decoded(response, Workspace.WorkQuestionResult);
  }

  const answered = await questions(book, target);
  expect(answered.questions[0]?.events).toHaveLength(2);
  await failure(
    await request(
      { ...book, token: book.agentToken },
      `/workspace/questions/${asked.question.id}/close`,
      {
        method: "POST",
        body: JSON.stringify({
          target,
          expectedTargetRevision: view.owner.revision,
          expectedRevision: 2,
          reason: "An agent cannot close a human question",
        }),
      },
    ),
    403,
    "Forbidden",
  );
  await failure(
    await request(foreign, "/workspace/questions/read", {
      method: "POST",
      body: JSON.stringify(target),
    }),
    404,
    "NotFound",
  );
  await writeFile(
    join(environment().artifacts, "work-question-refusals.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        root: view.root,
        questionId: asked.question.id,
        concurrentStatuses: responses
          .map((response) => response.status)
          .sort((left, right) => left - right),
        historyLength: 2,
        wrongHashRefused: true,
        foreignEvidenceRefused: true,
        staleOwnerRefused: true,
        agentClosureRefused: true,
      },
      null,
      2,
    ),
  );
});

test("native bank-row questions retain their real statement root without creating accounting or allocation", async () => {
  const base = await fixture();
  const book = { ...base, token: (await createSession(base)).token };
  const before = await persisted(book);

  const source = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: key(),
    sourceBankAccountId: "question_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    openingMinor: "0",
    closingMinor: "-10000",
    completeness: { declaredComplete: true, basis: "Independent synthetic statement" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-09-22",
        description: "Missing supplier original",
        amountMinor: "-10000",
      },
    ],
  };

  const evidence = await post(
    book,
    "/evidence",
    {
      title: "Retained bank question statement",
      mediaType: "application/json",
      content: JSON.stringify(source),
      origin: "Synthetic question fixture",
    },
    Accounting.Evidence,
  );

  const imported = await post(
    book,
    "/bank-statements",
    { ...source, evidenceId: evidence.id, existingMatches: [] },
    Bank.StatementImportReceipt,
  );

  const target = { kind: "bank", recordId: imported.statement.id, rowOrdinal: 1 } as const;
  const view = await questions(book, target);

  const question = await post(
    book,
    "/workspace/questions",
    {
      target,
      expectedTargetRevision: view.owner.revision,
      kind: "missing_evidence",
      question: "What is this retained payment?",
      requestedFrom: book.actorId,
    },
    Workspace.WorkQuestionResult,
  );

  expect(question.question.root).toEqual(view.root);
  expect(view.owner.target).toEqual(target);
  expect(view.owner.completed).toBe(false);
  expect(await persisted(book)).toEqual(before);

  const unchanged = await decoded(
    await request(book, `/bank-statements/${imported.statement.id}`),
    Bank.BankStatementView,
  );

  expect(unchanged.matches).toEqual([]);
  await writeFile(
    join(environment().artifacts, "work-question-bank-root.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        root: view.root,
        statementId: imported.statement.id,
        rowOrdinal: 1,
        questionId: question.question.id,
        ledgerUnchanged: true,
        matches: unchanged.matches,
      },
      null,
      2,
    ),
  );
});

test("question attachment bounds refuse another retained source without truncating history", async () => {
  const setup = await supplierFixture();
  const book = { ...setup.book, token: (await createSession(setup.book)).token };
  const original = await retain(book, "Bounded question original", "text/plain");
  await post(
    book,
    "/commerce/supplier-inbox",
    { occurrenceId: original.id, channel: "upload", messageIdentity: null },
    Inbox.SupplierInboxView,
  );
  const target = { kind: "document", recordId: original.id } as const;
  const view = await questions(book, target);

  const asked = await post(
    book,
    "/workspace/questions",
    {
      target,
      expectedTargetRevision: view.owner.revision,
      kind: "clarification",
      question: "Retain bounded supporting originals",
      requestedFrom: book.actorId,
    },
    Workspace.WorkQuestionResult,
  );

  let current = asked.question;

  for (let batch = 0; batch < 2; batch += 1) {
    const references = [];

    for (let index = 0; index < 5; index += 1) {
      const source = await retain(
        book,
        `Independent supporting source ${batch}/${index}`,
        "text/plain",
      );

      references.push({ occurrenceId: source.id, sha256: source.sha256 });
    }

    current = (
      await post(
        book,
        `/workspace/questions/${asked.question.id}/answers`,
        {
          target,
          expectedTargetRevision: view.owner.revision,
          expectedRevision: current.revision,
          text: `Bounded supplement ${batch}`,
          attachments: references,
        },
        Workspace.WorkQuestionResult,
      )
    ).question;
  }

  const extra = await retain(book, "An eleventh independent supporting source", "text/plain");
  await failure(
    await request(book, `/workspace/questions/${asked.question.id}/answers`, {
      method: "POST",
      body: JSON.stringify({
        target,
        expectedTargetRevision: view.owner.revision,
        expectedRevision: current.revision,
        text: "Must refuse rather than truncate",
        attachments: [{ occurrenceId: extra.id, sha256: extra.sha256 }],
      }),
    }),
    503,
    "Unavailable",
  );
  const retained = await questions(book, target);
  expect(retained.questions[0]?.events).toHaveLength(3);
  expect(retained.questions[0]?.events.flatMap((event) => event.attachments)).toHaveLength(10);
  await writeFile(
    join(environment().artifacts, "work-question-attachment-bound.json"),
    JSON.stringify(
      {
        root: retained.root,
        questionId: asked.question.id,
        revisions: 3,
        retainedAttachments: 10,
        refusal: "Unavailable",
        original: original.id,
      },
      null,
      2,
    ),
  );
});
