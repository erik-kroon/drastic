import * as Accounting from "@open-erp/contracts/accounting";
import * as Collections from "@open-erp/contracts/collections";
import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Crm from "@open-erp/contracts/crm-master";
import { checkSealedDispatchBasis } from "@open-erp/domain/collection-reminders";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { readInstant } from "../../db/commerce/access";
import * as ReminderDb from "../../db/commerce/reminders";
import * as DocumentDb from "../../db/commerce/documents";
import * as InvoiceDb from "../../db/commerce/invoices";
import * as CollectionDb from "../../db/commerce/collections";
import * as AllocationDb from "../../db/commerce/allocations";
import { admitPrincipal, recheckPrincipal } from "../../db/identity";
import { databaseFailure, withTransaction, type Transaction } from "../../db/transaction";
import { RequestEnvironment } from "../../runtime/environment";
import { failure } from "../failures";
import { digest } from "../json";
import { equalJson } from "@open-erp/domain/canonicalization";
import { ensureReminderInvoicePdf, readReminderInvoiceAttachment } from "./reminder-attachments";
import type { ReminderWireMessage } from "../../adapters/reminder-delivery/local-fixture";
import { newId, replay, saveCommand } from "../posting";
import { admitRunnerActor } from "../preparation-jobs";
import { resolveReviewedRecipient, readCustomerRecord } from "./customer-invoice-defaults";
import { decode, requireTableAccess, toJsonObject, withBook, type Scope } from "./support";
import { authorize } from "../authority";

const approvalLifetimeMs = 15 * 60 * 1000;

type Message = typeof Collections.ReminderMessage.Type;

type Attempt = typeof Collections.ReminderAttempt.Type;

type CurrentBasis = typeof Collections.ReminderCurrentBasis.Type;

type Blocker = typeof Collections.ReminderBlocker.Type;

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
      readonly attachments: ReminderWireMessage["attachments"];
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

function inspectCurrent(
  tx: Transaction,
  scope: Scope,
  reference: {
    readonly issueId: string;
    readonly invoiceId: string;
    readonly recipient: { readonly partyId: string };
  },
) {
  return Effect.gen(function* () {
    const issueRow = (yield* DocumentDb.readLegalIssue(tx, scope.bookId, reference.issueId))[0];
    const issue = issueRow ? yield* decode(Ar.ArLegalIssueReceipt, issueRow.body) : null;
    const invoice = (yield* InvoiceDb.readLiveInvoice(tx, scope.bookId, reference.invoiceId))[0];

    const disputes = yield* CollectionDb.readReminderDisputeBasis(
      tx,
      scope.bookId,
      reference.invoiceId,
    );

    const settlements = yield* AllocationDb.readReminderSettlements(
      tx,
      scope.bookId,
      reference.invoiceId,
    );

    if (disputes.length > 1000 || settlements.length > 1000)
      return yield* failure("UnsupportedProfile");

    const recipient = yield* readCustomerRecord(
      tx,
      scope,
      reference.recipient.partyId,
      "recipient",
    ).pipe(
      Effect.flatMap((body) => decode(Crm.ReviewedCustomerRecipient, body)),
      Effect.flatMap((record) => resolveReviewedRecipient(tx, scope, record, "payment_reminder")),
      Effect.mapError(databaseFailure),
      Effect.catchIf(
        (error) => error.code === "NotFound" || error.code === "StaleDependency",
        () => Effect.succeed(null),
      ),
    );

    const resolved = new Set(
      disputes.filter((row) => row.kind === "resolution").map((row) => row.body.disputeId),
    );

    return yield* decode(
      Collections.ReminderCurrentBasis,
      yield* toJsonObject({
        checkedAt: yield* retainedNow(tx),
        outstandingMinor: invoice?.outstandingMinor ?? null,
        invoiceDigest: invoice ? yield* digest(invoice.body) : null,
        issueDigest: issue?.digest ?? null,
        invoiceStatus: invoice?.status ?? null,
        customerName: issue?.draftSnapshot.content.customer.legalName ?? "",
        recipient: recipient
          ? {
              partyId: recipient.partyId,
              revision: recipient.revision,
              digest: recipient.digest,
              destination: recipient.destination,
            }
          : null,
        disputeBasisDigest: yield* digest(disputes),
        holdReminders:
          (yield* CollectionDb.readOpenReminderHold(tx, scope.bookId, reference.invoiceId))[0]
            ?.present === true,
        openDisputes: disputes.filter((row) => row.kind === "dispute" && !resolved.has(row.id))
          .length,
        settlements,
      }),
    );
  });
}

function sourceBlockers(message: Message, current: CurrentBasis): Blocker[] {
  const reasons: Blocker[] = [];

  if (message.attachments.length !== 1) reasons.push("source_changed");

  if (
    current.outstandingMinor === null ||
    current.issueDigest === null ||
    current.invoiceDigest === null
  )
    reasons.push("source_unavailable");
  else {
    if (BigInt(current.outstandingMinor) <= 0n) reasons.push("settled");

    if (current.outstandingMinor !== message.outstandingMinor) reasons.push("amount_changed");

    if (
      current.invoiceDigest !== message.invoiceDigest ||
      current.issueDigest !== message.issueDigest ||
      current.invoiceStatus === "blocked" ||
      current.invoiceStatus === "cancelled"
    )
      reasons.push("source_changed");
  }

  if (
    !current.recipient ||
    current.recipient.revision !== message.recipient.revision ||
    current.recipient.digest !== message.recipient.digest ||
    current.recipient.destination !== message.recipient.destination
  )
    reasons.push("recipient_changed");

  if (current.disputeBasisDigest !== message.disputeBasisDigest) reasons.push("dispute_changed");

  if (current.holdReminders) reasons.push("dispute_hold");

  return reasons;
}

function definitiveNonAcceptance(tx: Transaction, scope: Scope, messageId: string) {
  return Effect.gen(function* () {
    const attempt = (yield* ReminderDb.readAttempt(tx, scope.bookId, messageId))[0];
    const outbox = (yield* ReminderDb.readOutbox(tx, scope.bookId, messageId))[0];

    if (!attempt || outbox?.state !== "failed") return false;
    const observations = yield* ReminderDb.readObservations(tx, scope.bookId, attempt.id);

    if (observations.length > 1000) return yield* failure("UnsupportedProfile");
    const kinds = observations.map((row) => row.body.kind);

    return (
      kinds.includes("rejected") && !kinds.includes("accepted") && !kinds.includes("delivered")
    );
  });
}

function replacementEligible(current: CurrentBasis, blocked: boolean) {
  return (
    !blocked &&
    current.outstandingMinor !== null &&
    BigInt(current.outstandingMinor) > 0n &&
    current.invoiceStatus !== "blocked" &&
    current.invoiceStatus !== "cancelled" &&
    !current.holdReminders &&
    current.recipient !== null
  );
}

function assessReminder(tx: Transaction, scope: Scope, message: Message) {
  return Effect.gen(function* () {
    const current = yield* inspectCurrent(tx, scope, message);
    const approvalRow = (yield* ReminderDb.readApproval(tx, scope.bookId, message.id))[0];

    const approval = approvalRow
      ? yield* decode(Collections.ReminderApproval, approvalRow.body)
      : null;

    const refusalRow = (yield* ReminderDb.readRefusal(tx, scope.bookId, message.id))[0];
    const resolutionRow = (yield* ReminderDb.readResolution(tx, scope.bookId, message.id))[0];
    const attempt = (yield* ReminderDb.readAttempt(tx, scope.bookId, message.id))[0];
    const outbox = (yield* ReminderDb.readOutbox(tx, scope.bookId, message.id))[0];
    const refusal = refusalRow ? yield* decode(Collections.ReminderRefusal, refusalRow.body) : null;

    const resolution = resolutionRow
      ? yield* decode(Collections.ReminderResolution, resolutionRow.body)
      : null;

    const ambiguous =
      (yield* ReminderDb.readAmbiguousAttempt(tx, scope.bookId, message.invoiceId, message.id))[0]
        ?.present === true;

    const blockers = sourceBlockers(message, current);

    if (!approval) blockers.push("approval_required");
    else {
      if (Date.parse(approval.expiresAt) <= Date.parse(current.checkedAt))
        blockers.push("approval_expired");

      if (approval.messageDigest !== message.digest) blockers.push("source_changed");

      if (
        approvalRow &&
        (yield* ReminderDb.readApproverAuthority(tx, scope.bookId, approvalRow))[0]?.present !==
          true
      )
        blockers.push("authority_unavailable");
    }

    if (refusal || outbox?.state === "refused") blockers.push("refused");

    if (resolution) blockers.push(resolution.kind);
    else if (outbox?.state === "cancelled") blockers.push("cancelled");

    if (attempt) blockers.push("already_admitted");

    if (ambiguous) blockers.push("ambiguous_attempt");

    const rejected = yield* definitiveNonAcceptance(tx, scope, message.id);

    const replacementAllowed = replacementEligible(
      current,
      Boolean((attempt && !rejected) || resolution || outbox?.state === "cancelled" || ambiguous),
    );

    return { current, approval, refusal, resolution, blockers, replacementAllowed };
  });
}

function retainRefusal(
  tx: Transaction,
  scope: Scope,
  message: Message,
  reasons: readonly Blocker[],
  current: CurrentBasis,
) {
  return Effect.gen(function* () {
    const previous = (yield* ReminderDb.readRefusal(tx, scope.bookId, message.id))[0];

    if (previous) return yield* decode(Collections.ReminderRefusal, previous.body);

    if ((yield* ReminderDb.readAttempt(tx, scope.bookId, message.id))[0])
      return yield* failure("StaleDependency");
    const approvalRow = (yield* ReminderDb.readApproval(tx, scope.bookId, message.id))[0];

    if (!approvalRow) return yield* failure("ApprovalRequired");
    const approval = yield* decode(Collections.ReminderApproval, approvalRow.body);

    const body = yield* sealed({
      id: newId("reminder_refusal"),
      scope,
      messageId: message.id,
      messageDigest: message.digest,
      approvalDigest: approval.digest,
      current,
      reasons,
      admission: "not_admitted",
    });

    const result = yield* decode(Collections.ReminderRefusal, body);
    yield* ReminderDb.insertRefusal(tx, scope.bookId, message.id, body);

    return result;
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

    const disputes = yield* CollectionDb.readReminderDisputeBasis(tx, scope.bookId, invoice.id);

    if (disputes.length > 1000) return yield* failure("UnsupportedProfile");

    return {
      issue,
      invoice,
      outstandingMinor: invoice.outstandingMinor,
      destination,
      invoiceDigest: yield* digest(invoice.body),
      disputeBasisDigest: yield* digest(disputes),
    };
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

function prepareWithin(
  tx: Transaction,
  actorId: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Collections.PrepareReminder.Type;
  },
  requestDigest: string,
) {
  return Effect.gen(function* () {
    const basis = yield* source(tx, command.scope, command.input.issueId, command.input.recipient);

    if (
      (yield* ReminderDb.readAmbiguousAttempt(tx, command.scope.bookId, basis.invoice.id, ""))[0]
        ?.present
    )
      return yield* failure("StaleDependency");

    const reviewBasis = yield* inspectCurrent(tx, command.scope, {
      issueId: basis.issue.id,
      invoiceId: basis.invoice.id,
      recipient: command.input.recipient,
    });

    const preparedAt = reviewBasis.checkedAt;
    const dueOn = basis.issue.draftSnapshot.content.dueDate;

    if (dueOn === null || dueOn > Accounting.swedishBusinessDate(new Date(preparedAt)))
      return yield* failure("InvalidJournal");
    const outstandingMinor = basis.invoice.outstandingMinor;

    if (outstandingMinor === null) return yield* failure("StaleDependency");
    const minor = BigInt(outstandingMinor);
    const wholeAmount = `${new Intl.NumberFormat("sv").format(minor / 100n)},${(minor % 100n).toString().padStart(2, "0")}`;

    const number = basis.issue.legalDocumentNumber;

    const dueDate = new Intl.DateTimeFormat("sv", {
      day: "numeric",
      month: "long",
      timeZone: "Europe/Stockholm",
    }).format(new Date(`${dueOn}T12:00:00Z`));

    const senderName = basis.issue.policySnapshot.candidate.input.sellerIdentity.legalName;
    const subject = `Påminnelse: faktura ${number}, förföll ${dueDate}`;
    const plainText = `Hej,\n\nfaktura ${number} på ${wholeAmount} kr förföll den ${dueDate}. Vi ser att den ännu inte är betald. Betala gärna snarast, uppgifterna finns på den bifogade fakturan.\n\nHör av dig om fakturan redan är betald eller om något är oklart.\n\nVänliga hälsningar\n${senderName}`;
    const html = `<p>${htmlEscape(plainText).replaceAll("\n", "<br />")}</p>`;

    const attachment = yield* readReminderInvoiceAttachment(tx, command.scope, basis.issue.id);

    const body = yield* sealed({
      id: newId("reminder"),
      scope: command.scope,
      issueId: basis.issue.id,
      issueDigest: basis.issue.digest,
      invoiceId: basis.invoice.id,
      invoiceNumber: number,
      invoiceDigest: basis.invoiceDigest,
      disputeBasisDigest: basis.disputeBasisDigest,
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
      preparedBy: actorId,
      preparedByName: (yield* ReminderDb.readActorName(tx, actorId))[0]?.name ?? actorId,
      senderName,
      subject,
      plainText,
      html,
      encoding: "UTF-8",
      attachments: [attachment.reference],
      feeMinor: "0",
      interestMinor: "0",
      bankCoverage: "not_qualified",
      provider: "local-fixture-v1",
      reviewBasis,
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
  });
}

export const prepareReminder = Effect.fn("commerce.reminders.prepare")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Collections.PrepareReminder.Type;
  },
) {
  yield* ensureReminderInvoicePdf(token, command.scope, command.input.issueId);

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

      return yield* prepareWithin(tx, principal.actorId, command, requestDigest);
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
    const assessed = yield* assessReminder(tx, scope, message);

    return yield* decode(Collections.ReminderView, {
      message,
      current: assessed.current,
      approvalUsable: assessed.blockers.length === 0,
      approvalBlockers: assessed.blockers,
      refusal: assessed.refusal,
      resolution: assessed.resolution,
      cancellation: assessed.resolution?.kind === "cancelled" ? assessed.resolution : null,
      replacementAllowed: assessed.replacementAllowed,
      approval: approvalRow ? yield* decode(Collections.ReminderApproval, approvalRow.body) : null,
      attempt: attemptRow ? yield* decode(Collections.ReminderAttempt, attemptRow.body) : null,
      observations: observations.map((observation) => observation.body),
      outcomeCheck: outbox ? { checkpoint: outbox.checkpoint, checkedAt: outbox.checkedAt } : null,
      status:
        assessed.resolution && !attemptRow
          ? "cancelled"
          : outbox?.state === "awaiting_dispatch"
            ? "approved"
            : (outbox?.state ?? "prepared"),
      reason: outbox?.reason ?? null,
      delivered: observations.some((observation) => observation.body.kind === "delivered"),
      currentOutstandingMinor: assessed.current.outstandingMinor,
      currentHoldReminders: assessed.current.holdReminders,
      currentSettlementCheckedAt: assessed.current.checkedAt,
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
      yield* authorize(principal, "approve_reminder");
      yield* requireTableAccess(tx, ReminderDb.reminderTables, true);
      const message = yield* checkedMessage(tx, command);
      const previous = (yield* ReminderDb.readApproval(tx, command.scope.bookId, command.id))[0];

      const assessment = yield* assessReminder(tx, command.scope, message);

      if (previous) {
        if (
          assessment.blockers.includes("authority_unavailable") ||
          assessment.blockers.includes("approval_expired")
        )
          return yield* failure("ApprovalRequired");

        if (assessment.blockers.length > 0) return yield* failure("StaleDependency");

        return yield* view(tx, command.scope, command.id);
      }

      if (assessment.blockers.some((reason) => reason !== "approval_required"))
        return yield* failure("StaleDependency");

      const approver = yield* authorize(principal, "approve_reminder");
      const current = yield* source(tx, command.scope, message.issueId, message.recipient);

      if (
        current.invoiceDigest !== message.invoiceDigest ||
        current.issue.digest !== message.issueDigest ||
        current.disputeBasisDigest !== message.disputeBasisDigest
      )
        return yield* failure("StaleDependency");
      const approvedAt = yield* retainedNow(tx);

      const body = yield* sealed({
        id: newId("reminder_approval"),
        messageId: message.id,
        messageDigest: message.digest,
        approvedBy: principal.actorId,
        approvedByName:
          (yield* ReminderDb.readActorName(tx, principal.actorId))[0]?.name ?? principal.actorId,
        approvedAt,
        expiresAt: new Date(Date.parse(approvedAt) + approvalLifetimeMs).toISOString(),
      });

      yield* ReminderDb.insertApproval(tx, {
        bookId: command.scope.bookId,
        messageId: message.id,
        actorId: principal.actorId,
        sessionId: approver.sessionId,
        body,
      });
      yield* ReminderDb.insertOutbox(tx, command.scope.bookId, message.id, approvedAt);

      return yield* view(tx, command.scope, message.id);
    },
    "update",
  );
});

export const requestReminderDispatch = Effect.fn("commerce.reminders.requestDispatch")(function* (
  token: string,
  command: Command,
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* authorize(principal, "request_reminder_dispatch");
      yield* requireTableAccess(tx, ReminderDb.reminderTables, true);
      const message = yield* checkedMessage(tx, command);
      const outbox = (yield* ReminderDb.readOutbox(tx, command.scope.bookId, command.id))[0];

      if (!outbox) return yield* failure("ApprovalRequired");

      if (outbox.state !== "awaiting_dispatch") return yield* view(tx, command.scope, command.id);

      const assessment = yield* assessReminder(tx, command.scope, message);

      if (assessment.blockers.length > 0) {
        yield* retainRefusal(tx, command.scope, message, assessment.blockers, assessment.current);

        yield* ReminderDb.advanceOutbox(
          tx,
          command.scope.bookId,
          command.id,
          "refused",
          "StaleDependency",
          assessment.current.checkedAt,
          outbox.checkpoint,
          outbox.cancelVersion,
        );

        return yield* view(tx, command.scope, command.id);
      }

      yield* ReminderDb.advanceOutbox(
        tx,
        command.scope.bookId,
        command.id,
        "approved",
        null,
        yield* retainedNow(tx),
        outbox.checkpoint,
        outbox.cancelVersion,
      );

      return yield* view(tx, command.scope, command.id);
    },
    "update",
  );
});

function retireOutbox(tx: Transaction, scope: Scope, messageId: string, reason: string) {
  return Effect.gen(function* () {
    const outbox = (yield* ReminderDb.readOutbox(tx, scope.bookId, messageId))[0];

    if (outbox)
      yield* ReminderDb.advanceOutbox(
        tx,
        scope.bookId,
        messageId,
        "cancelled",
        reason,
        yield* retainedNow(tx),
        outbox.checkpoint,
        1,
      );
  });
}

export const cancelReminder = Effect.fn("commerce.reminders.cancel")(function* (
  token: string,
  command: Command & { readonly idempotencyKey: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* authorize(principal, "cancel_reminder");
      yield* requireTableAccess(tx, ReminderDb.reminderTables, true);
      const message = yield* checkedMessage(tx, command);

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "reminder_cancel",
        principal.actorId,
        yield* toJsonObject(command),
        Collections.ReminderCancellation,
      );

      if (request.previous) return yield* view(tx, command.scope, command.id);

      if ((yield* ReminderDb.readAttempt(tx, command.scope.bookId, command.id))[0])
        return yield* failure("StaleDependency");
      const previous = (yield* ReminderDb.readResolution(tx, command.scope.bookId, command.id))[0];
      const prior = previous ? yield* decode(Collections.ReminderResolution, previous.body) : null;

      if (prior?.kind === "replaced") return yield* failure("StaleDependency");

      const body = prior
        ? yield* toJsonObject(prior)
        : yield* sealed({
            id: newId("reminder_resolution"),
            scope: command.scope,
            messageId: message.id,
            messageDigest: message.digest,
            actorId: principal.actorId,
            decidedAt: yield* retainedNow(tx),
            kind: "cancelled",
          });

      const result = yield* decode(Collections.ReminderCancellation, body);

      if (!prior)
        yield* ReminderDb.insertResolution(
          tx,
          command.scope.bookId,
          command.id,
          principal.actorId,
          null,
          body,
        );
      yield* retireOutbox(tx, command.scope, command.id, "Cancelled before dispatch admission.");
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "reminder_cancel",
        principal.actorId,
        yield* toJsonObject(result),
      );

      return yield* view(tx, command.scope, command.id);
    },
    "update",
  );
});

export const checkReminder = Effect.fn("commerce.reminders.check")(function* (
  token: string,
  command: Command & { readonly idempotencyKey: string },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      yield* requireTableAccess(tx, ReminderDb.reminderTables, true);
      const message = yield* checkedMessage(tx, command);

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "reminder_check",
        principal.actorId,
        yield* toJsonObject(command),
        Collections.ReminderView,
      );

      if (request.previous) return yield* view(tx, command.scope, command.id);
      const attempt = (yield* ReminderDb.readAttempt(tx, command.scope.bookId, command.id))[0];
      const assessment = yield* assessReminder(tx, command.scope, message);

      if (
        !attempt &&
        assessment.approval &&
        !assessment.resolution &&
        !assessment.refusal &&
        assessment.blockers.length > 0
      ) {
        yield* retainRefusal(tx, command.scope, message, assessment.blockers, assessment.current);
        const outbox = (yield* ReminderDb.readOutbox(tx, command.scope.bookId, command.id))[0];

        if (outbox)
          yield* ReminderDb.advanceOutbox(
            tx,
            command.scope.bookId,
            command.id,
            "refused",
            "StaleDependency",
            assessment.current.checkedAt,
            outbox.checkpoint,
            outbox.cancelVersion,
          );
      }

      const result = yield* view(tx, command.scope, command.id);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "reminder_check",
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const replaceReminder = Effect.fn("commerce.reminders.replace")(function* (
  token: string,
  command: Command & {
    readonly idempotencyKey: string;
    readonly input: typeof Collections.ReplaceReminder.Type;
  },
) {
  const original = yield* readReminder(token, { scope: command.scope, id: command.id });
  yield* ensureReminderInvoicePdf(token, command.scope, original.message.issueId);

  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      yield* authorize(principal, "replace_reminder");
      yield* requireTableAccess(tx, ReminderDb.reminderTables, true);
      const message = yield* checkedMessage(tx, command);

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        "reminder_replace",
        principal.actorId,
        yield* toJsonObject(command),
        Collections.ReminderReplacement,
      );

      if (request.previous) return request.previous;

      const attempt = (yield* ReminderDb.readAttempt(tx, command.scope.bookId, command.id))[0];

      if (attempt && !(yield* definitiveNonAcceptance(tx, command.scope, command.id)))
        return yield* failure("StaleDependency");
      const previous = (yield* ReminderDb.readResolution(tx, command.scope.bookId, command.id))[0];

      const resolution = previous
        ? yield* decode(Collections.ReminderResolution, previous.body)
        : null;

      if (resolution?.kind === "cancelled") return yield* failure("StaleDependency");
      let result: typeof Collections.ReminderReplacement.Type;

      if (resolution?.kind === "replaced") {
        const row = (yield* ReminderDb.readMessage(
          tx,
          command.scope.bookId,
          resolution.replacementMessageId,
        ))[0];

        if (!row) return yield* failure("InternalError");
        const child = yield* decode(Collections.ReminderMessage, row.body);
        const recipient = command.input.recipient;

        if (
          child.recipient.partyId !== recipient.partyId ||
          child.recipient.revision !== recipient.revision ||
          child.recipient.digest !== recipient.digest
        )
          return yield* failure("IdempotencyConflict");
        result = { message: child, resolution };
      } else {
        const assessment = yield* assessReminder(tx, command.scope, message);

        if (!assessment.replacementAllowed) return yield* failure("StaleDependency");

        if (!attempt && assessment.approval && assessment.blockers.length > 0)
          yield* retainRefusal(tx, command.scope, message, assessment.blockers, assessment.current);

        const child = yield* prepareWithin(
          tx,
          principal.actorId,
          {
            scope: command.scope,
            idempotencyKey: `replacement_${request.expected}`,
            input: { issueId: message.issueId, recipient: command.input.recipient },
          },
          request.expected,
        );

        const body = yield* sealed({
          id: newId("reminder_resolution"),
          scope: command.scope,
          messageId: message.id,
          messageDigest: message.digest,
          actorId: principal.actorId,
          decidedAt: yield* retainedNow(tx),
          kind: "replaced",
          replacementMessageId: child.id,
          replacementMessageDigest: child.digest,
        });

        const retained = yield* decode(Collections.ReminderResolution, body);
        yield* ReminderDb.insertResolution(
          tx,
          command.scope.bookId,
          message.id,
          principal.actorId,
          child.id,
          body,
        );

        if (!attempt)
          yield* retireOutbox(
            tx,
            command.scope,
            message.id,
            "Replaced by a separately reviewed reminder.",
          );
        result = { message: child, resolution: retained };
      }

      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "reminder_replace",
        principal.actorId,
        yield* toJsonObject(result),
      );

      return result;
    },
    "update",
  );
});

export const listReminders = Effect.fn("commerce.reminders.list")(function* (
  token: string,
  input: { readonly scope: Scope; readonly invoiceId: string; readonly after?: string },
) {
  return yield* withBook(token, input.scope, false, function* (tx) {
    if (!(yield* InvoiceDb.readLiveInvoice(tx, input.scope.bookId, input.invoiceId))[0])
      return yield* failure("NotFound");

    if (input.after) {
      const anchor = (yield* ReminderDb.readMessage(tx, input.scope.bookId, input.after))[0];

      if (!anchor || anchor.body.invoiceId !== input.invoiceId) return yield* failure("NotFound");
    }

    const rows = yield* ReminderDb.readInvoiceMessages(
      tx,
      input.scope.bookId,
      input.invoiceId,
      input.after ?? "",
    );

    const messages = yield* Effect.forEach(rows.slice(0, 20), (row) =>
      decode(Collections.ReminderMessage, row.body),
    );

    return yield* decode(Collections.ReminderHistoryPage, {
      scope: input.scope,
      invoiceId: input.invoiceId,
      items: messages.map((message) => ({
        id: message.id,
        issueId: message.issueId,
        invoiceNumber: message.invoiceNumber,
        preparedAt: message.preparedAt,
      })),
      next: rows.length > 20 ? (messages.at(-1)?.id ?? null) : null,
    });
  });
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
      yield* authorize(principal, "reconcile_reminder");
      yield* checkedMessage(tx, command);

      const resolution = (yield* ReminderDb.readResolution(
        tx,
        command.scope.bookId,
        command.id,
      ))[0];

      if (resolution) return yield* view(tx, command.scope, command.id);
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

      yield* authorize(principal, "dispatch_reminder");
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
          attachments: [],
        } satisfies Admission;
      const assessed = yield* assessReminder(tx, payload.scope, message);
      const now = assessed.current.checkedAt;
      const reasons = [...assessed.blockers];

      if (denied && !reasons.includes("authority_unavailable"))
        reasons.push("authority_unavailable");

      if (outbox.cancelVersion !== 0 && !reasons.includes("cancelled")) reasons.push("cancelled");

      const gate = checkSealedDispatchBasis({
        messageDigest: message.digest,
        approvedDigest: approval.messageDigest,
        approvedResidualMinor: message.outstandingMinor,
        current:
          assessed.current.outstandingMinor === null
            ? null
            : {
                residualMinor: assessed.current.outstandingMinor,
                sourceCurrent: sourceBlockers(message, assessed.current).length === 0,
              },
        cancelled: outbox.cancelVersion !== 0,
      });

      if (Result.isFailure(gate) && reasons.length === 0) reasons.push("source_changed");

      const attachment = yield* readReminderInvoiceAttachment(
        tx,
        payload.scope,
        message.issueId,
      ).pipe(
        Effect.catchIf(
          (error) => "code" in error && error.code === "StaleDependency",
          () => Effect.succeed(null),
        ),
      );

      if (!attachment || !equalJson(message.attachments, [attachment.reference])) {
        if (!reasons.includes("source_changed")) reasons.push("source_changed");
      }

      if (reasons.length > 0) {
        yield* retainRefusal(tx, payload.scope, message, reasons, assessed.current);
        yield* ReminderDb.advanceOutbox(
          tx,
          payload.scope.bookId,
          payload.messageId,
          "refused",
          denied ?? (reasons.includes("approval_expired") ? "ApprovalRequired" : "StaleDependency"),
          now,
          outbox.checkpoint,
          outbox.cancelVersion,
        );

        return { action: "skip" } satisfies Admission;
      }

      if (!attachment) return yield* failure("StaleDependency");

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

      return {
        action: "submit",
        message,
        attempt,
        attachments: [{ ...attachment.reference, contentBase64: attachment.contentBase64 }],
      } satisfies Admission;
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
      yield* authorize(principal, "retain_reminder_outcome");

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
            attachments: admission.attachments,
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
      yield* authorize(principal, "stop_reminder_delivery");
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

      if (!attempt) {
        const row = (yield* ReminderDb.readMessage(tx, payload.scope.bookId, payload.messageId))[0];

        if (!row) return yield* failure("NotFound");
        const message = yield* decode(Collections.ReminderMessage, row.body);
        const current = yield* inspectCurrent(tx, payload.scope, message);
        yield* retainRefusal(tx, payload.scope, message, ["delivery_exhausted"], current);
      }

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
