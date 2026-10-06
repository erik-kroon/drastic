import * as Workspace from "@open-erp/contracts/workspace";
import { post, type BookFixture } from "./fixtures";

export function supplierQuestions(book: BookFixture, draftId: string) {
  return post(
    book,
    "/workspace/questions/read",
    { kind: "supplier", recordId: draftId },
    Workspace.WorkQuestionsView,
  );
}

export async function askSupplierQuestion(book: BookFixture, draftId: string, text: string) {
  const view = await supplierQuestions(book, draftId);

  const result = await post(
    book,
    "/workspace/questions",
    {
      target: { kind: "supplier", recordId: draftId },
      expectedTargetRevision: view.owner.revision,
      kind: "clarification",
      question: text,
      requestedFrom: book.actorId,
    },
    Workspace.WorkQuestionResult,
  );

  return result.question;
}

export async function closeSupplierQuestion(
  book: BookFixture,
  draftId: string,
  questionId: string,
) {
  const view = await supplierQuestions(book, draftId);
  const question = view.questions.find((item) => item.id === questionId);

  if (!question) throw new Error("The scoped retained question is missing");
  const target = { kind: "supplier", recordId: draftId } as const;

  const answered = await post(
    book,
    `/workspace/questions/${questionId}/answers`,
    {
      target,
      expectedTargetRevision: view.owner.revision,
      expectedRevision: question.revision,
      text: "Operator reviewed the retained original and current task",
      attachments: [],
    },
    Workspace.WorkQuestionResult,
  );

  const closed = await post(
    book,
    `/workspace/questions/${questionId}/close`,
    {
      target,
      expectedTargetRevision: view.owner.revision,
      expectedRevision: answered.question.revision,
      reason: "Explicit operator closure before the owning accounting operation",
    },
    Workspace.WorkQuestionResult,
  );

  return closed.question;
}
