import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Workspace from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectField, TextareaField } from "@open-erp/ui/components/field";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { QuestionTaskContext } from "@open-erp/ui/components/question-task-context";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import {
  QuestionAttachment,
  QuestionMessage,
  QuestionThread,
} from "@open-erp/ui/components/question-thread";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "./accounting-status";
import { OriginalDocument } from "./original-document";
import { DocumentUpload } from "./document-inbox";
import { CommandForm, checkScope, type CommerceProps } from "./commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { sourceDocumentOptions } from "@/lib/source-documents";
import { coordinationOptions } from "@/lib/workspace-coordination";
import { attentionCopy, attentionState } from "@/lib/attention";
import { formatMinorAmount } from "@/lib/workspace-api";

type Target = typeof Workspace.QuestionTarget.Type;

type View = typeof Workspace.WorkQuestionsView.Type;

type Question = typeof Workspace.WorkQuestion.Type;

type Member = (typeof Workspace.Coordination.Type)["members"][number];

type QuestionProps = CommerceProps & { target: Target };

export function attentionQuestionTarget(item: typeof Workspace.AttentionItem.Type): Target | null {
  if (!item.questionRoot) return null;

  if (item.supplierReview) return { kind: "journal", recordId: item.id };

  if (item.kind === "document" || item.kind === "supplier")
    return { kind: item.kind, recordId: item.id };

  return null;
}

export function WorkQuestionsEntry(
  props: QuestionProps & {
    summary?: typeof Workspace.QuestionSummary.Type | null;
    task?: { item: typeof Workspace.AttentionItem.Type; assignee: string };
  },
) {
  const [open, setOpen] = useState(false);
  const sv = props.locale === "sv";
  const item = props.task?.item;
  const questionLabel = `${sv ? "Frågor att besvara" : "Questions to answer"}${props.summary && props.summary.unresolved > 0 ? ` (${props.summary.unresolved})` : ""}`;

  return (
    <>
      <Button static variant="ghost" onClick={() => setOpen(true)}>
        {questionLabel}
      </Button>
      {open ? (
        <RecordSheet
          presentation="question"
          title={sv ? "Frågor att besvara" : "Questions to answer"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => setOpen(false)}
          context={
            item && props.task ? (
              <QuestionTaskContext
                heading={sv ? "Att göra" : "To do"}
                kind={attentionCopy(props.locale)[item.kind]}
                title={item.title}
                state={attentionState(item, props.locale)}
                date={new Intl.DateTimeFormat(props.locale, { dateStyle: "medium" }).format(
                  new Date(item.updatedAt),
                )}
                amount={
                  item.amountMinor !== null && item.currencyScale !== null
                    ? `${formatMinorAmount(item.amountMinor, item.currencyScale, props.locale)} ${item.currency ?? ""}`
                    : "—"
                }
                assignee={props.task.assignee}
                questions={questionLabel}
              />
            ) : undefined
          }
        >
          <WorkQuestionsPanel {...props} />
        </RecordSheet>
      ) : null}
    </>
  );
}

function assertQuestions(view: View, book: CommerceProps["book"]) {
  checkScope(book, view.scope);
  const prefix = `${book.entityId}/${book.id}/`;

  if (!view.root.key.startsWith(prefix)) throw new Error("Question root scope mismatch");

  for (const question of view.questions) {
    checkScope(book, question.scope);

    if (question.root.key !== view.root.key) throw new Error("Question root identity mismatch");
  }
}

function memberName(members: readonly Member[], id: string) {
  return members.find((member) => member.id === id)?.name ?? id;
}

function questionTime(locale: CommerceProps["locale"], value: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function WorkQuestionsPanel(props: QuestionProps) {
  const { book, target, locale } = props;
  const sv = locale === "sv";
  const client = useQueryClient();
  const team = useQuery(coordinationOptions(book));

  const questions = useQuery({
    queryKey: [...bookKey(book), "work-questions", target],
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${bookPath(book)}/workspace/questions/read`,
        Workspace.WorkQuestionsView,
        { method: "POST", body: JSON.stringify(target), signal },
      );

      assertQuestions(view, book);

      return view;
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  const view = questions.isSuccess ? questions.data : undefined;
  const members = team.isSuccess ? team.data.members : [];
  const ready = questions.isSuccess && !questions.isFetching && book.role === "operator";

  const refresh = () => {
    void client.invalidateQueries({ queryKey: bookKey(book) });
  };

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box>
        <Button
          variant="outline"
          disabled={questions.isFetching}
          onClick={() => void questions.refetch()}
        >
          {sv ? "Uppdatera" : "Refresh"}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={questions.isPending} error={questions.error} />
      <AccountingStatus locale={locale} pending={team.isPending} error={team.error} />
      {view ? (
        <>
          {view.questions.length === 0 ? (
            <PageEmpty title={sv ? "Inga frågor" : "No questions"} />
          ) : null}
          {view.questions.map((question) => (
            <WorkQuestionRecord
              {...props}
              key={question.id}
              view={view}
              question={question}
              members={members}
              ready={ready}
              onChanged={refresh}
            />
          ))}
          {team.isSuccess && (!view.owner.completed || view.root.kind === "bank") ? (
            <AskQuestion
              {...props}
              view={view}
              members={members}
              ready={ready}
              onChanged={refresh}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function AskQuestion(
  props: QuestionProps & {
    view: View;
    members: readonly Member[];
    ready: boolean;
    onChanged: () => void;
  },
) {
  const sv = props.locale === "sv";

  return (
    <RecordSection title={sv ? "Ställ en fråga" : "Ask a question"}>
      <CommandForm
        {...props}
        path={`${bookPath(props.book)}/workspace/questions`}
        schema={Workspace.AskWorkQuestion}
        output={Workspace.WorkQuestionResult}
        label={sv ? "Ställ en fråga" : "Ask a question"}
        allowed={props.ready}
        input={(fields) => ({
          target: props.target,
          expectedTargetRevision: props.view.owner.revision,
          kind: fields.get("kind"),
          question: fields.get("question"),
          requestedFrom: fields.get("requestedFrom"),
        })}
        onSuccess={props.onChanged}
      >
        <SelectField
          name="kind"
          label={sv ? "Fråga" : "Question"}
          defaultValue="clarification"
          options={[
            { value: "clarification", label: sv ? "Fråga" : "Question" },
            { value: "missing_evidence", label: sv ? "Originalet saknas" : "Original missing" },
          ]}
        />
        <SelectField
          name="requestedFrom"
          label={sv ? "Till" : "To"}
          required
          options={[
            { value: "", label: "—" },
            ...props.members
              .filter((member) => member.role === "operator")
              .map((member) => ({
                value: member.id,
                label: member.name,
              })),
          ]}
        />
        <TextareaField
          name="question"
          label={sv ? "Fråga" : "Question"}
          rows={3}
          maxLength={2000}
          required
        />
      </CommandForm>
    </RecordSection>
  );
}

type RecordProps = QuestionProps & {
  view: View;
  question: Question;
  members: readonly Member[];
  ready: boolean;
  onChanged: () => void;
};

function questionStatus(question: Question, locale: CommerceProps["locale"]) {
  const sv = locale === "sv";

  if (question.state === "closed") return sv ? "Löst" : "Resolved";

  if (question.state === "answered") return sv ? "Besvarad" : "Answered";

  return question.kind === "missing_evidence"
    ? sv
      ? "Originalet saknas"
      : "Original missing"
    : sv
      ? "Väntar på svar"
      : "Awaiting answer";
}

function WorkQuestionRecord(props: RecordProps) {
  const { question, view, members, locale } = props;
  const sv = locale === "sv";
  const status = questionStatus(question, locale);

  return (
    <QuestionThread title={question.question} status={status} state={question.state}>
      {question.waitingOn ? (
        <PageCaption>
          {question.waitingOn === view.actorId
            ? sv
              ? "Väntar på dig"
              : "Waiting for you"
            : `${sv ? "Väntar på" : "Waiting for"} ${memberName(members, question.waitingOn)}`}
        </PageCaption>
      ) : null}
      {question.events.map((event) => (
        <QuestionMessage
          key={event.revision}
          actor={memberName(members, event.actorId)}
          createdAt={event.createdAt}
          time={questionTime(locale, event.createdAt)}
          text={event.text}
          reply={event.action === "answered"}
        >
          {event.attachments.map((attachment) => (
            <QuestionAttachment
              key={attachment.occurrenceId}
              filename={attachment.filename}
              status={attachmentStatus(attachment.availability, locale)}
            >
              {attachment.availability === "readable" ? (
                <OriginalDocument
                  book={props.book}
                  locale={props.locale}
                  id={attachment.occurrenceId}
                  sha256={attachment.sha256}
                  compact
                />
              ) : null}
            </QuestionAttachment>
          ))}
        </QuestionMessage>
      ))}
      <QuestionActions {...props} />
    </QuestionThread>
  );
}

function attachmentStatus(
  availability: (typeof Workspace.QuestionAttachment.Type)["availability"],
  locale: CommerceProps["locale"],
) {
  const sv = locale === "sv";

  switch (availability) {
    case "readable":
      return sv ? "Sparad i Dokument" : "Saved in Documents";
    case "unreadable":
      return sv ? "Kan inte öppnas" : "Cannot open";
    case "unavailable":
      return sv ? "Förhandsvisning saknas" : "Preview unavailable";
  }
}

function QuestionActions(props: RecordProps) {
  const { question, view } = props;
  const sv = props.locale === "sv";

  if (question.state === "closed") return null;

  const mayAnswer =
    (!view.owner.completed || view.root.kind === "bank") &&
    (view.actorId === question.requestedFrom || view.actorId === question.askedBy);

  return (
    <Box display="grid" gap="lg">
      {mayAnswer ? <AnswerQuestion {...props} key={`${question.id}/${question.revision}`} /> : null}
      {question.state === "answered" && view.actorId === question.askedBy ? (
        <CommandForm
          {...props}
          path={`${bookPath(props.book)}/workspace/questions/${encodeURIComponent(question.id)}/close`}
          schema={Workspace.CloseWorkQuestion}
          output={Workspace.WorkQuestionResult}
          label={sv ? "Markera som löst" : "Mark resolved"}
          allowed={props.ready}
          input={(fields) => ({
            target: props.target,
            expectedTargetRevision: view.owner.revision,
            expectedRevision: question.revision,
            reason: fields.get("reason"),
          })}
          onSuccess={props.onChanged}
        >
          <TextareaField
            name="reason"
            label={sv ? "Granskning" : "Review"}
            rows={2}
            maxLength={2000}
            required
          />
        </CommandForm>
      ) : null}
      {question.state === "answered" ? (
        <PageCaption>
          {sv
            ? `Svaret har gått till ${memberName(props.members, question.askedBy)} och uppgiften ligger hos ${memberName(props.members, question.askedBy)}. Du kan komplettera svaret tills den är bokförd. Frågan stängs när ${memberName(props.members, question.askedBy)} har löst uppgiften.`
            : `The answer returns to ${memberName(props.members, question.askedBy)} for review. You can supplement it until the task is posted. The asker closes the question after resolving the task.`}
        </PageCaption>
      ) : null}
    </Box>
  );
}

function AnswerQuestion(props: RecordProps) {
  const sv = props.locale === "sv";
  const [uploading, setUploading] = useState(false);
  const [occurrenceId, setOccurrenceId] = useState("");

  const source = useQuery({
    ...sourceDocumentOptions(props.book, occurrenceId),
    enabled: occurrenceId.length > 0,
  });

  const attachment = source.isSuccess ? source.data.occurrence : undefined;

  return (
    <Box display="grid" gap="lg">
      <Box>
        <Button variant="outline" onClick={() => setUploading(true)}>
          {sv ? "Ladda upp nytt kvitto" : "Upload new receipt"}
        </Button>
      </Box>
      {uploading ? (
        <DocumentUpload
          onSaved={(id) => {
            setOccurrenceId(id);
            setUploading(false);
          }}
        />
      ) : null}
      {occurrenceId ? (
        <AccountingStatus locale={props.locale} pending={source.isPending} error={source.error} />
      ) : null}
      {attachment ? <PageCaption>{attachment.filename}</PageCaption> : null}
      <CommandForm
        {...props}
        path={`${bookPath(props.book)}/workspace/questions/${encodeURIComponent(props.question.id)}/answers`}
        schema={Workspace.AnswerWorkQuestion}
        output={Workspace.WorkQuestionResult}
        label={sv ? "Komplettera svaret" : "Supplement answer"}
        allowed={props.ready && !uploading && (!occurrenceId || source.isSuccess)}
        input={(fields) => ({
          target: props.target,
          expectedTargetRevision: props.view.owner.revision,
          expectedRevision: props.question.revision,
          text: fields.get("text"),
          attachments: attachment
            ? [{ occurrenceId: attachment.id, sha256: attachment.sha256 }]
            : [],
        })}
        onSuccess={props.onChanged}
      >
        <TextareaField
          name="text"
          label={sv ? "Svar" : "Answer"}
          rows={3}
          maxLength={2000}
          required
        />
      </CommandForm>
    </Box>
  );
}
