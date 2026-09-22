import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import * as Schema from "effect/Schema";
import { bookPath, readAccounting } from "@/lib/accounting-api";

export function savedPostingPath(book: typeof Accounting.Book.Type) {
  return `${bookPath(book)}/saved-posting-requests`;
}

export async function readSavedPostingRequest(
  book: typeof Accounting.Book.Type,
  key: string,
  signal?: AbortSignal,
) {
  const result = await readAccounting(
    `${savedPostingPath(book)}/${encodeURIComponent(key)}`,
    Recovery.SavedPostingRequest,
    { signal },
  );
  if (
    result.scope.bookId !== book.id ||
    result.scope.entityId !== book.entityId ||
    result.request.key !== key
  )
    throw new Error("Response scope mismatch");
  return result;
}

export async function runSavedPostingRequest(
  book: typeof Accounting.Book.Type,
  saved: typeof Recovery.SavedPostingRequest.Type,
) {
  const authority =
    saved.command.operation === "approve_change" || saved.command.operation === "revoke_approval";
  const path = `${bookPath(book)}/${authority ? "saved-posting-authority-requests" : "saved-posting-requests"}/${encodeURIComponent(saved.request.key)}/run`;
  const result = await readAccounting(path, Recovery.SavedPostingRequest, { method: "POST" });
  if (
    result.scope.bookId !== book.id ||
    result.scope.entityId !== book.entityId ||
    result.request.key !== saved.request.key ||
    result.request.requestDigest !== saved.request.requestDigest
  )
    throw new Error("Response scope mismatch");
  return result;
}

// Called only from an explicit user action, never on mount or from a query.
export async function sendSavedPostingCommand(request: {
  book: typeof Accounting.Book.Type;
  actorId: string;
  command: typeof Recovery.SavedPostingCommand.Type;
  storageMessage: string;
  replaceTerminal?: boolean;
}) {
  const body = JSON.stringify(request.command);
  const path = `${bookPath(request.book)}/${request.command.operation === "approve_change" || request.command.operation === "revoke_approval" ? "saved-posting-authority-requests" : "saved-posting-requests"}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([request.actorId, path, body])),
  );
  const identity = `openerp:saved-posting:v1:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  let key: string | null;
  try {
    key = localStorage.getItem(identity);
  } catch {
    throw new Error(request.storageMessage);
  }
  if (key !== null && !Schema.is(Recovery.SavedRequestKey)(key))
    throw new Error(request.storageMessage);
  if (key === null) key = crypto.randomUUID();
  async function save(originalKey: string) {
    try {
      localStorage.setItem(identity, originalKey);
      if (localStorage.getItem(identity) !== originalKey) throw new Error(request.storageMessage);
    } catch {
      throw new Error(request.storageMessage);
    }
    const saved = await readAccounting(path, Recovery.SavedPostingRequest, {
      method: "POST",
      body,
      headers: { "Idempotency-Key": originalKey },
    });
    if (
      saved.scope.bookId !== request.book.id ||
      saved.scope.entityId !== request.book.entityId ||
      saved.request.key !== originalKey ||
      saved.request.actorId !== request.actorId ||
      saved.command.operation !== request.command.operation
    )
      throw new Error("Response scope mismatch");
    return saved;
  }
  let saved = await save(key);
  // A failed save/read or an unknown result cannot rotate identity.
  if (request.replaceTerminal && saved.sameActor && saved.outcome !== null)
    saved = await save(crypto.randomUUID());
  return runSavedPostingRequest(request.book, saved);
}
