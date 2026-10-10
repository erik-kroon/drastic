import * as Templates from "@open-erp/contracts/invoice-templates";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Effect from "effect/Effect";
import { readSealedDraft } from "../../db/posting-admission";
import { lockBookForUpdate } from "../../db/posting";
import { readInstant } from "../../db/commerce/access";
import * as TemplateDb from "../../db/commerce/invoice-templates";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import type { Transaction } from "../../db/transaction";
import { digest } from "../json";
import { newId } from "../identifiers";
import { replay, saveCommand } from "../command-receipts";
import { failure } from "../failures";
import {
  createInvoiceDraftInTransaction,
  reviseInvoiceDraftInTransaction,
} from "./invoice-lifecycle";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  withBook,
  type Principal,
  type Scope,
} from "./support";

type Template = typeof Templates.InvoiceTemplateRevision.Type;

type Command = { scope: Scope; idempotencyKey: string };

const pageSize = 50;

const maximumTemplates = 1000;

function validateContent(content: typeof Templates.TemplateContent.Type) {
  return new Set(content.lines.map((line) => line.id)).size === content.lines.length
    ? Effect.void
    : failure("InvalidJournal");
}

const retainedTemplate = Effect.fn("commerce.templates.retain")(function* (
  transaction: Transaction,
  principal: Principal,
  scope: Scope,
  id: string,
  revision: string,
  input: {
    name: string;
    currency: string;
    currencyScale: number;
    status: "active" | "archived";
    content: typeof Templates.TemplateContent.Type;
    reason: string;
  },
) {
  yield* validateContent(input.content);
  const recordedAt = (yield* readInstant(transaction))[0]?.instant;

  if (recordedAt === undefined) return yield* failure("InternalError");

  const body = yield* toJsonObject({
    ...input,
    id,
    scope,
    revision,
    recordedBy: principal.actorId,
    recordedAt,
  });

  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 65536)
    return yield* failure("InvalidJournal");

  const result = yield* decode(Templates.InvoiceTemplateRevision, {
    ...body,
    digest: yield* digest(body),
  });

  yield* TemplateDb.insertTemplateRevision(transaction, {
    bookId: scope.bookId,
    templateId: id,
    revision: BigInt(revision),
    body: yield* toJsonObject(result),
  });

  return result;
});

export const listInvoiceTemplates = Effect.fn("commerce.templates.list")(function* (
  token: string,
  input: { scope: Scope; after?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, TemplateDb.templateTables, false);

    const rows = yield* TemplateDb.readTemplates(
      transaction,
      input.scope.bookId,
      input.after ?? "",
      pageSize + 1,
    );

    const visible = rows.slice(0, pageSize);

    return yield* decode(Templates.InvoiceTemplatePage, {
      scope: input.scope,
      items: visible.map((row) => row.body),
      next: rows.length > pageSize ? (visible[visible.length - 1]?.id ?? null) : null,
    });
  });
});

export const getInvoiceTemplate = Effect.fn("commerce.templates.get")(function* (
  token: string,
  input: { scope: Scope; id: string; revision?: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireTableAccess(transaction, TemplateDb.templateTables, false);

    const row = (yield* TemplateDb.readTemplate(
      transaction,
      input.scope.bookId,
      input.id,
      input.revision,
    ))[0];

    if (row === undefined) return yield* failure("NotFound");

    return yield* decode(Templates.InvoiceTemplateRevision, row.body);
  });
});

export const createInvoiceTemplate = Effect.fn("commerce.templates.create")(function* (
  token: string,
  command: Command & { input: typeof Templates.CreateInvoiceTemplate.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const operation = "create_invoice_template";

      const prior = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        Templates.InvoiceTemplateRevision,
      );

      if (prior.previous) return prior.previous;
      yield* requireTableAccess(transaction, TemplateDb.templateTables, true);
      yield* lockBookForUpdate(transaction, command.scope);
      const book = (yield* DraftDb.readBookCurrency(transaction, command.scope.bookId))[0];

      if (
        book?.currency !== command.input.currency ||
        book.currencyScale !== command.input.currencyScale
      )
        return yield* failure("UnsupportedProfile");
      const count = (yield* TemplateDb.countTemplates(transaction, command.scope.bookId))[0];

      if (count === undefined || count.count >= maximumTemplates)
        return yield* failure("UnsupportedProfile");
      const id = newId("invoice_template");
      yield* TemplateDb.insertTemplate(transaction, command.scope.bookId, id);

      const result = yield* retainedTemplate(transaction, principal, command.scope, id, "1", {
        ...command.input,
        status: "active",
      });

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        prior.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

type ChangeTemplateCommand = Command & { id: string } & (
    | { kind: "revise"; input: typeof Templates.ReviseInvoiceTemplate.Type }
    | { kind: "archive"; input: typeof Templates.ArchiveInvoiceTemplate.Type }
  );

const changeInvoiceTemplate = Effect.fn("commerce.templates.change")(function* (
  token: string,
  command: ChangeTemplateCommand,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const operation =
        command.kind === "archive" ? "archive_invoice_template" : "revise_invoice_template";

      const prior = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { id: command.id, input: command.input },
        Templates.InvoiceTemplateRevision,
      );

      if (prior.previous) return prior.previous;
      yield* requireTableAccess(transaction, TemplateDb.templateTables, true);
      yield* lockBookForUpdate(transaction, command.scope);

      const row = (yield* TemplateDb.readTemplate(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];

      if (row === undefined) return yield* failure("NotFound");
      const current = yield* decode(Templates.InvoiceTemplateRevision, row.body);

      if (
        current.revision !== command.input.expectedRevision ||
        current.digest !== command.input.expectedDigest
      )
        return yield* failure("StaleDependency");

      if (current.status === "archived" || BigInt(current.revision) >= 1000n)
        return yield* failure("UnsupportedProfile");
      const revision = (BigInt(current.revision) + 1n).toString();

      const result = yield* retainedTemplate(
        transaction,
        principal,
        command.scope,
        command.id,
        revision,
        {
          name: command.kind === "revise" ? command.input.name : current.name,
          currency: current.currency,
          currencyScale: current.currencyScale,
          status: command.kind === "archive" ? "archived" : "active",
          content: command.kind === "revise" ? command.input.content : current.content,
          reason: command.input.reason,
        },
      );

      yield* TemplateDb.advanceTemplate(
        transaction,
        command.scope.bookId,
        command.id,
        BigInt(revision),
      );
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        prior.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const reviseInvoiceTemplate = Effect.fn("commerce.templates.revise")(function* (
  token: string,
  command: Command & { id: string; input: typeof Templates.ReviseInvoiceTemplate.Type },
) {
  return yield* changeInvoiceTemplate(token, { ...command, kind: "revise" });
});

export const archiveInvoiceTemplate = Effect.fn("commerce.templates.archive")(function* (
  token: string,
  command: Command & { id: string; input: typeof Templates.ArchiveInvoiceTemplate.Type },
) {
  return yield* changeInvoiceTemplate(token, { ...command, kind: "archive" });
});

const applyToDraft = Effect.fn("commerce.templates.applyToDraft")(function* (
  transaction: Transaction,
  principal: Principal,
  command: Command & { id: string; input: typeof Templates.ApplyInvoiceTemplate.Type },
  template: Template,
) {
  const target = command.input.target;
  const selection = { id: template.id, revision: template.revision, digest: template.digest };
  const idempotencyKey = newId("template_draft");

  if (target.kind === "new") {
    return yield* createInvoiceDraftInTransaction(
      transaction,
      principal,
      {
        scope: command.scope,
        idempotencyKey,
        input: {
          draftKey: target.draftKey,
          commercial: { ...target.context, ...template.content },
        },
      },
      selection,
    );
  }

  yield* requireTableAccess(
    transaction,
    [...DraftDb.invoiceDraftTables, "invoice_issues", "ar_legal_issues"],
    false,
  );

  if ((yield* readSealedDraft(transaction, command.scope.bookId, target.id, "customer")).length)
    return yield* failure("Forbidden");
  const row = (yield* DraftDb.readDraftHead(transaction, command.scope.bookId, target.id))[0];

  if (row === undefined) return yield* failure("NotFound");
  const draft = yield* decode(Drafts.InvoiceDraftRevision, row.body);

  if (draft.purpose !== "commercial") return yield* failure("UnsupportedProfile");

  return yield* reviseInvoiceDraftInTransaction(
    transaction,
    principal,
    {
      scope: command.scope,
      id: target.id,
      idempotencyKey,
      input: {
        expectedRevision: target.expectedRevision,
        expectedDigest: target.expectedDigest,
        reason: command.input.reason,
        commercial: { ...draft.commercialInput, ...template.content },
      },
    },
    selection,
  );
});

export const applyInvoiceTemplate = Effect.fn("commerce.templates.apply")(function* (
  token: string,
  command: Command & { id: string; input: typeof Templates.ApplyInvoiceTemplate.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    command.input.target.kind === "existing",
    function* (transaction, principal) {
      const operation = "apply_invoice_template";

      const prior = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { id: command.id, input: command.input },
        Drafts.InvoiceDraftRevision,
      );

      if (prior.previous) return prior.previous;
      yield* requireTableAccess(transaction, TemplateDb.templateTables, false);
      yield* lockBookForUpdate(transaction, command.scope);

      const row = (yield* TemplateDb.readTemplate(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];

      if (row === undefined) return yield* failure("NotFound");
      const template = yield* decode(Templates.InvoiceTemplateRevision, row.body);

      if (template.revision !== command.input.revision || template.digest !== command.input.digest)
        return yield* failure("StaleDependency");

      if (template.status !== "active") return yield* failure("UnsupportedProfile");
      const book = (yield* DraftDb.readBookCurrency(transaction, command.scope.bookId))[0];

      if (book?.currency !== template.currency || book.currencyScale !== template.currencyScale)
        return yield* failure("UnsupportedProfile");
      const result = yield* applyToDraft(transaction, principal, command, template);
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        prior.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});
