import * as Accounting from "@open-erp/contracts/accounting";
import * as Collections from "@open-erp/contracts/collections";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Effect from "effect/Effect";
import { readInstant } from "../../db/commerce/access";
import * as ReminderDb from "../../db/commerce/reminders";
import * as DocumentDb from "../../db/commerce/documents";
import * as InvoiceDb from "../../db/commerce/invoices";
import * as CollectionDb from "../../db/commerce/collections";
import { requireHumanSession } from "../../db/human-actor";
import { admitPrincipal, recheckPrincipal } from "../../db/identity";
import { databaseFailure, withTransaction, type Transaction } from "../../db/transaction";
import { RequestEnvironment } from "../../runtime/environment";
import { failure } from "../failures";
import { digest } from "../json";
import { newId } from "../posting";
import { admitRunnerActor } from "../preparation-jobs";
import { resolveReviewedRecipient } from "./customer-invoice-defaults";
import { decode, requireTableAccess, toJsonObject, withBook, type Scope } from "./support";

const approvalLifetimeMs = 15 * 60 * 1000;

type Message = typeof Collections.ReminderMessage.Type;

type Attempt = typeof Collections.ReminderAttempt.Type;

type Command = {
  readonly scope: Scope;
  readonly id: string;
  readonly input: typeof Collections.ReminderCommand.Type;
};

type Payload = { readonly scope: Scope; readonly messageId: string; readonly checkpoint: number };

type Admission =
  | {
      readonly action: "submit" | "reconcile";
      readonly message: Message;
      readonly attempt: Attempt;
    }
  | { readonly action: "skip" };

function retainedNow(tx: Transaction) {
  return readInstant(tx).pipe(
    Effect.flatMap((rows) =>
      rows[0]?.instant === undefined ? failure("InternalError") : Effect.succeed(rows[0].instant),
    ),
  );
}

function sealed(value: unknown) {
  return Effect.gen(function* () {
    const body = yield* toJsonObject(value);

    return { ...body, digest: yield* digest(body) };
  });
}

function source(
  tx: Transaction,
  scope: Scope,
  issueId: string,
  recipient: typeof Collections.ReminderRecipientReference.Type,
) {
  return Effect.gen(function* () {
    const issueRow = (yield* DocumentDb.readLegalIssue(tx, scope.bookId, issueId))[0];

    if (!issueRow) return yield* failure("NotFound");
    const issue = yield* decode(Ar.ArLegalIssueReceipt, issueRow.body);

    if (
      issue.draftSnapshot.content.currency !== "SEK" ||
      issue.draftSnapshot.content.currencyScale !== 2
    )
      return yield* failure("UnsupportedProfile");

    if (issue.draftSnapshot.content.counterpartyId !== recipient.partyId)
      return yield* failure("StaleDependency");
    const destination = yield* resolveReviewedRecipient(tx, scope, recipient, "payment_reminder");

    const invoice = (yield* InvoiceDb.readLiveInvoice(
      tx,
      scope.bookId,
      issue.registerInvoiceId,
    ))[0];

    if (!invoice) return yield* failure("NotFound");

    const held =
      (yield* CollectionDb.readOpenReminderHold(tx, scope.bookId, issue.registerInvoiceId))[0]
        ?.present === true;

    if (
      held ||
      invoice.outstandingMinor === null ||
      BigInt(invoice.outstandingMinor) <= 0n ||
      invoice.status === "blocked" ||
      invoice.status === "cancelled"
    )
      return yield* failure("StaleDependency");

    return { issue, invoice, destination, invoiceDigest: yield* digest(invoice.body) };
  });
}

function htmlEscape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const prepareReminder = Effect.fn("commerce.reminders.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Collections.PrepareReminder.Type;
  },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      yield* requireTableAccess(tx, ReminderDb.reminderTables, true);

      const requestDigest = yield* digest({
        operation: "prepare_payment_reminder",
        actorId: principal.actorId,
        input: command.input,
      });

      const previous = (yield* ReminderDb.readPreparedCommand(
        tx,
        command.scope.bookId,
        command.idempotencyKey,
      ))[0];

      if (previous) {
        if (previous.requestDigest !== requestDigest) return yield* failure("IdempotencyConflict");

        return yield* decode(Collections.ReminderMessage, previous.body);
      }

      const basis = yield* source(
        tx,
        command.scope,
        command.input.issueId,
        command.input.recipient,
      );

      const preparedAt = yield* retainedNow(tx);
      const dueOn = basis.issue.draftSnapshot.content.dueDate;

      if (dueOn === null || dueOn > Accounting.swedishBusinessDate(new Date(preparedAt)))
        return yield* failure("InvalidJournal");
      const outstandingMinor = basis.invoice.outstandingMinor;

      if (outstandingMinor === null) return yield* failure("StaleDependency");
      const minor = BigInt(outstandingMinor);
      const amount = `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")} SEK`;
      const number = basis.issue.legalDocumentNumber;
      const subject = `Payment reminder for invoice ${number}`;
      const plainText = `Payment reminder\nInvoice: ${number}\nDue date: ${dueOn}\nOutstanding as of ${preparedAt}: ${amount}\nNo reminder fee or interest is included.\nIf you have already paid, please contact us so we can review the payment.`;
      const html = `<h1>Payment reminder</h1><p>Invoice: ${htmlEscape(number)}</p><p>Due date: ${htmlEscape(dueOn)}</p><p>Outstanding as of ${htmlEscape(preparedAt)}: ${htmlEscape(amount)}</p><p>No reminder fee or interest is included.</p><p>If you have already paid, please contact us so we can review the payment.</p>`;

      const body = yield* sealed({
        id: newId("reminder"),
        scope: command.scope,
        issueId: basis.issue.id,
        issueDigest: basis.issue.digest,
        invoiceId: basis.invoice.id,
        invoiceNumber: number,
        invoiceDigest: basis.invoiceDigest,
        outstandingMinor,
        currency: "SEK",
        currencyScale: 2,
        dueOn,
        recipient: {
          ...command.input.recipient,
          channel: "email",
          destination: basis.destination.destination,
        },
        preparedAt,
        preparedBy: principal.actorId,
        subject,
        plainText,
        html,
        encoding: "UTF-8",
        attachments: [],
        feeMinor: "0",
        interestMinor: "0",
        bankCoverage: "not_qualified",
        provider: "local-fixture-v1",
      });

      const result = yield* decode(Collections.ReminderMessage, body);
      yield* ReminderDb.insertMessage(tx, {
        bookId: command.scope.bookId,
        id: result.id,
        prepareKey: command.idempotencyKey,
        requestDigest,
        body,
      });

      return result;
    },
    "update",
  );
});

function checkedMessage(tx: Transaction, command: Command) {
  return Effect.gen(function* () {
    const row = (yield* ReminderDb.readMessage(tx, command.scope.bookId, command.id))[0];

    if (!row) return yield* failure("NotFound");
    const message = yield* decode(Collections.ReminderMessage, row.body);

    if (message.digest !== command.input.messageDigest) return yield* failure("StaleDependency");

    return message;
  });
}

function view(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* ReminderDb.readMessage(tx, scope.bookId, id))[0];

    if (!row) return yield* failure("NotFound");
    const message = yield* decode(Collections.ReminderMessage, row.body);
    const approvalRow = (yield* ReminderDb.readApproval(tx, scope.bookId, id))[0];
    const attemptRow = (yield* ReminderDb.readAttempt(tx, scope.bookId, id))[0];
    const outbox = (yield* ReminderDb.readOutbox(tx, scope.bookId, id))[0];

    const observations = attemptRow
      ? yield* ReminderDb.readObservations(tx, scope.bookId, attemptRow.id)
      : [];

    if (observations.length > 1000) return yield* failure("UnsupportedProfile");
    const current = (yield* InvoiceDb.readLiveInvoice(tx, scope.bookId, message.invoiceId))[0];

    const held =
      (yield* CollectionDb.readOpenReminderHold(tx, scope.bookId, message.invoiceId))[0]
        ?.present === true;

    return yield* decode(Collections.ReminderView, {
      message,
      approval: approvalRow ? yield* decode(Collections.ReminderApproval, approvalRow.body) : null,
      attempt: attemptRow ? yield* decode(Collections.ReminderAttempt, attemptRow.body) : null,
      observations: observations.map((observation) => observation.body),
      status: outbox?.state ?? "prepared",
      reason: outbox?.reason ?? null,
      delivered: observations.some((observation) => observation.body.kind === "delivered"),
      currentOutstandingMinor: current?.outstandingMinor ?? null,
      currentHoldReminders: held,
      currentSettlementCheckedAt: yield* retainedNow(tx),
      liveProviderEnabled: false,
    });
  });
}

export const readReminder = Effect.fn("commerce.reminders.read")(function* (
  token: string,
  input: { readonly scope: Scope; readonly id: string },
) {
  return yield* withBook(token, input.scope, false, function* (tx) {
    yield* requireTableAccess(tx, ReminderDb.reminderTables, false);

    return yield* view(tx, input.scope, input.id);
  });
});

export const approveReminder = Effect.fn("commerce.reminders.approve")(function* (
  token: string,
  command: Command & { readonly input: typeof Collections.ApproveReminder.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireHumanSession(principal);
      yield* requireTableAccess(tx, ReminderDb.reminderTables, true);
      const message = yield* checkedMessage(tx, command);
      const previous = (yield* ReminderDb.readApproval(tx, command.scope.bookId, command.id))[0];

      if (previous) return yield* view(tx, command.scope, command.id);

      if (principal.kind !== "betterAuthSession") return yield* failure("Forbidden");
      const current = yield* source(tx, command.scope, message.issueId, message.recipient);

      if (
        current.invoiceDigest !== message.invoiceDigest ||
        current.issue.digest !== message.issueDigest
      )
        return yield* failure("StaleDependency");
      const approvedAt = yield* retainedNow(tx);

      const body = yield* sealed({
        id: newId("reminder_approval"),
        messageId: message.id,
        messageDigest: message.digest,
        approvedBy: principal.actorId,
        approvedAt,
        expiresAt: new Date(Date.parse(approvedAt) + approvalLifetimeMs).toISOString(),
      });

      yield* ReminderDb.insertApproval(tx, {
        bookId: command.scope.bookId,
        messageId: message.id,
        actorId: principal.actorId,
        sessionId: principal.sessionId,
        body,
      });
      yield* ReminderDb.insertOutbox(tx, command.scope.bookId, message.id, approvedAt);

      return yield* view(tx, command.scope, message.id);
    },
    "update",
  );
});

export const cancelReminder = Effect.fn("commerce.reminders.cancel")(function* (
  token: string,
  command: Command,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireHumanSession(principal);
      yield* checkedMessage(tx, command);
      const outbox = (yield* ReminderDb.readOutbox(tx, command.scope.bookId, command.id))[0];
      const attempt = (yield* ReminderDb.readAttempt(tx, command.scope.bookId, command.id))[0];

      if (!outbox) return yield* failure("ApprovalRequired");

      if (attempt) return yield* failure("StaleDependency");
      yield* ReminderDb.advanceOutbox(
        tx,
        command.scope.bookId,
        command.id,
        "cancelled",
        "Cancelled before dispatch admission.",
        yield* retainedNow(tx),
        outbox.checkpoint,
        1,
      );

      return yield* view(tx, command.scope, command.id);
    },
    "update",
  );
});

export const reconcileReminder = Effect.fn("commerce.reminders.reconcile")(function* (
  token: string,
  command: Command,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* requireHumanSession(principal);
      yield* checkedMessage(tx, command);
      const outbox = (yield* ReminderDb.readOutbox(tx, command.scope.bookId, command.id))[0];
      const attempt = (yield* ReminderDb.readAttempt(tx, command.scope.bookId, command.id))[0];

      if (!outbox || !attempt) return yield* failure("StaleDependency");

      if (outbox.state === "delivered") return yield* view(tx, command.scope, command.id);

      if (outbox.checkpoint >= 1000) return yield* failure("UnsupportedProfile");

      if (outbox.state !== "reconciling" && outbox.state !== "admitted")
        yield* ReminderDb.advanceOutbox(
          tx,
          command.scope.bookId,
          command.id,
          "reconciling",
          null,
          yield* retainedNow(tx),
          outbox.checkpoint + 1,
          outbox.cancelVersion,
        );

      return yield* view(tx, command.scope, command.id);
    },
    "update",
  );
});

export const pendingReminders = Effect.fn("commerce.reminders.pending")(function* (token: string) {
  return yield* withTransaction((tx) =>
    Effect.gen(function* () {
      const actorId = yield* admitRunnerActor(tx, token);
      yield* requireTableAccess(tx, ReminderDb.reminderTables, false);

      return yield* ReminderDb.readPending(tx, actorId);
    }),
  );
});

function admitDispatch(token: string, payload: Payload) {
  return withTransaction((tx) =>
    Effect.gen(function* () {
      let denied: typeof Accounting.FailureCode.Type | null = null;

      const principal = yield* admitPrincipal(
        tx,
        { token },
        payload.scope,
        {
          operatorOnly: false,
          beforeBook: (authorityTx) =>
            Effect.gen(function* () {
              const previousAttempt = (yield* ReminderDb.readAttempt(
                authorityTx,
                payload.scope.bookId,
                payload.messageId,
              ))[0];

              if (previousAttempt) return;

              const approved = (yield* ReminderDb.readApproval(
                authorityTx,
                payload.scope.bookId,
                payload.messageId,
              ))[0];

              if (!approved) return;
              yield* recheckPrincipal(
                authorityTx,
                {
                  actorId: approved.actorId,
                  kind: "betterAuthSession",
                  sessionId: approved.sessionId,
                },
                payload.scope,
                { operatorOnly: true },
                "update",
              ).pipe(
                Effect.mapError(databaseFailure),
                Effect.catchIf(
                  (error) => error.code === "Unauthorized" || error.code === "Forbidden",
                  (error) => {
                    denied = error.code;

                    return Effect.void;
                  },
                ),
              );
            }).pipe(Effect.mapError(databaseFailure)),
        },
        "update",
      );

      if (principal.kind !== "apiCredential") return yield* failure("Forbidden");
      yield* requireTableAccess(tx, ReminderDb.reminderTables, true);
      const outbox = (yield* ReminderDb.readOutbox(tx, payload.scope.bookId, payload.messageId))[0];

      if (
        !outbox ||
        outbox.checkpoint !== payload.checkpoint ||
        !["approved", "admitted", "reconciling"].includes(outbox.state)
      )
        return { action: "skip" } satisfies Admission;

      const messageRow = (yield* ReminderDb.readMessage(
        tx,
        payload.scope.bookId,
        payload.messageId,
      ))[0];

      const approvalRow = (yield* ReminderDb.readApproval(
        tx,
        payload.scope.bookId,
        payload.messageId,
      ))[0];

      if (!messageRow || !approvalRow) return yield* failure("NotFound");
      const message = yield* decode(Collections.ReminderMessage, messageRow.body);
      const approval = yield* decode(Collections.ReminderApproval, approvalRow.body);

      const previous = (yield* ReminderDb.readAttempt(
        tx,
        payload.scope.bookId,
        payload.messageId,
      ))[0];

      if (previous)
        return {
          action: "reconcile",
          message,
          attempt: yield* decode(Collections.ReminderAttempt, previous.body),
        } satisfies Admission;
      const now = yield* retainedNow(tx);

      const refusal =
        denied ?? (Date.parse(approval.expiresAt) <= Date.parse(now) ? "ApprovalRequired" : null);

      if (refusal !== null) {
        yield* ReminderDb.advanceOutbox(
          tx,
          payload.scope.bookId,
          payload.messageId,
          "refused",
          refusal,
          now,
          outbox.checkpoint,
          outbox.cancelVersion,
        );

        return { action: "skip" } satisfies Admission;
      }

      const checked = yield* source(tx, payload.scope, message.issueId, message.recipient).pipe(
        Effect.map(
          (current) =>
            current.invoiceDigest === message.invoiceDigest &&
            current.issue.digest === message.issueDigest,
        ),
        Effect.mapError(databaseFailure),
        Effect.catchIf(
          (error) => error.code === "StaleDependency" || error.code === "NotFound",
          () => Effect.succeed(false),
        ),
      );

      if (!checked || approval.messageDigest !== message.digest || outbox.cancelVersion !== 0) {
        yield* ReminderDb.advanceOutbox(
          tx,
          payload.scope.bookId,
          payload.messageId,
          "refused",
          "StaleDependency",
          now,
          outbox.checkpoint,
          outbox.cancelVersion,
        );

        return { action: "skip" } satisfies Admission;
      }

      const externalIdentity = `${payload.scope.bookId}/${message.id}/${message.digest}`;

      const body = yield* sealed({
        id: newId("reminder_attempt"),
        messageId: message.id,
        messageDigest: message.digest,
        approvalId: approval.id,
        externalIdentity,
        admittedAt: now,
      });

      const attempt = yield* decode(Collections.ReminderAttempt, body);
      yield* ReminderDb.insertAttempt(tx, {
        bookId: payload.scope.bookId,
        messageId: message.id,
        id: attempt.id,
        externalIdentity,
        body,
      });
      yield* ReminderDb.advanceOutbox(
        tx,
        payload.scope.bookId,
        payload.messageId,
        "admitted",
        null,
        now,
        outbox.checkpoint,
        outbox.cancelVersion,
      );

      return { action: "submit", message, attempt } satisfies Admission;
    }),
  );
}

function retainOutcome(
  token: string,
  payload: Payload,
  attempt: Attempt,
  outcome: typeof Collections.ReminderProviderObservation.Type | null,
) {
  return withBook(
    token,
    payload.scope,
    false,
    function* (tx, principal) {
      if (principal.kind !== "apiCredential") return yield* failure("Forbidden");

      const savedAttempt = (yield* ReminderDb.readAttempt(
        tx,
        payload.scope.bookId,
        payload.messageId,
      ))[0];

      const outbox = (yield* ReminderDb.readOutbox(tx, payload.scope.bookId, payload.messageId))[0];

      if (
        !savedAttempt ||
        !outbox ||
        savedAttempt.id !== attempt.id ||
        savedAttempt.externalIdentity !== attempt.externalIdentity
      )
        return yield* failure("StaleDependency");
      const now = yield* retainedNow(tx);
      const observations = yield* ReminderDb.readObservations(tx, payload.scope.bookId, attempt.id);

      if (observations.length > 1000) return yield* failure("UnsupportedProfile");

      if (outcome !== null) {
        if (outcome.externalIdentity !== attempt.externalIdentity)
          return yield* failure("StaleDependency");

        const previous = observations.find(
          (row) => row.body.observationId === outcome.observationId,
        );

        if (
          previous &&
          (previous.body.kind !== outcome.kind ||
            previous.body.externalIdentity !== outcome.externalIdentity)
        )
          return yield* failure("StaleDependency");

        if (!previous && observations.length === 1000) return yield* failure("UnsupportedProfile");

        if (!previous)
          yield* ReminderDb.insertObservation(tx, {
            bookId: payload.scope.bookId,
            attemptId: attempt.id,
            observationId: outcome.observationId,
            body: yield* sealed({ ...outcome, recordedAt: now, provider: "local-fixture-v1" }),
            recordedAt: now,
          });
      }

      const kinds = observations.map((row) => row.body.kind);

      const state: ReminderDb.OutboxState =
        kinds.includes("delivered") || outcome?.kind === "delivered"
          ? "delivered"
          : kinds.includes("accepted") || outcome?.kind === "accepted"
            ? "provider_accepted"
            : kinds.includes("rejected") || outcome?.kind === "rejected"
              ? "failed"
              : "outcome_unknown";

      yield* ReminderDb.advanceOutbox(
        tx,
        payload.scope.bookId,
        payload.messageId,
        state,
        outcome === null
          ? "Provider outcome unavailable. Reconcile the admitted identity; do not resend."
          : null,
        now,
        outbox.checkpoint,
        outbox.cancelVersion,
      );

      return attempt.id;
    },
    "update",
  );
}

export const dispatchReminder = Effect.fn("commerce.reminders.dispatch")(function* (
  payload: Payload,
) {
  const { bindings } = yield* RequestEnvironment;
  const token = bindings.OPENERP_PREPARATION_TOKEN;
  const delivery = bindings.REMINDER_DELIVERY;

  if (!token || !delivery) return yield* failure("Unavailable");
  const admission = yield* admitDispatch(token, payload);

  if (admission.action === "skip") return payload.messageId;
  const { message, attempt } = admission;

  const outcome = yield* Effect.tryPromise({
    try: () =>
      admission.action === "reconcile"
        ? delivery.reconcile(attempt.externalIdentity)
        : delivery.submit({
            externalIdentity: attempt.externalIdentity,
            messageDigest: message.digest,
            destination: message.recipient.destination,
            subject: message.subject,
            plainText: message.plainText,
            html: message.html,
          }),
    catch: () => failure("Unavailable"),
  }).pipe(Effect.orElseSucceed(() => null));

  return yield* retainOutcome(token, payload, attempt, outcome);
});

export const stopReminderDelivery = Effect.fn("commerce.reminders.stopDelivery")(function* (
  payload: Payload,
) {
  const { bindings } = yield* RequestEnvironment;
  const token = bindings.OPENERP_PREPARATION_TOKEN;

  if (!token) return yield* failure("Unavailable");

  return yield* withBook(
    token,
    payload.scope,
    false,
    function* (tx, principal) {
      if (principal.kind !== "apiCredential") return yield* failure("Forbidden");
      const outbox = (yield* ReminderDb.readOutbox(tx, payload.scope.bookId, payload.messageId))[0];

      if (
        !outbox ||
        outbox.checkpoint !== payload.checkpoint ||
        !["approved", "admitted", "reconciling"].includes(outbox.state)
      )
        return;

      const attempt = (yield* ReminderDb.readAttempt(
        tx,
        payload.scope.bookId,
        payload.messageId,
      ))[0];

      yield* ReminderDb.advanceOutbox(
        tx,
        payload.scope.bookId,
        payload.messageId,
        attempt ? "outcome_unknown" : "refused",
        "Durable delivery exhausted. Inspect the retained attempt before any further contact.",
        yield* retainedNow(tx),
        outbox.checkpoint,
        outbox.cancelVersion,
      );
    },
    "update",
  );
});
