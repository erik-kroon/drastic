import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import * as Schema from "effect/Schema";
import { bookPath, readAccounting } from "@/lib/accounting-api";

export async function postingRequestOptions(request: {
  book: typeof Accounting.Book.Type;
  actorId: string;
  path: string;
  payload: typeof Accounting.ApproveChange.Type | typeof Accounting.ExecuteChange.Type;
  checkedAt: string;
  storageMessage: string;
}): Promise<RequestInit> {
  const body = JSON.stringify(request.payload);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([request.actorId, request.path, body])),
  );
  const identity = `openerp:posting:v1:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  let key: string | null;
  try {
    key = localStorage.getItem(identity);
  } catch {
    throw new Error(request.storageMessage);
  }
  if (key !== null && !Schema.is(Accounting.IdempotencyHeaders.fields["idempotency-key"])(key)) {
    throw new Error(request.storageMessage);
  }
  // Only a server-observed expired approval permits a deliberate new approval key.
  // A missing or uncertain receipt always retains the old key.
  if (key !== null && request.path.endsWith("/approvals")) {
    const receipt = await readAccounting(
      `${bookPath(request.book)}/posting-requests/${encodeURIComponent(key)}`,
      Recovery.RecoveredPostingRequest,
    );
    if (
      receipt.state === "committed" &&
      receipt.sameActor &&
      receipt.operation === "approve_change" &&
      Schema.is(Accounting.Approval)(receipt.result) &&
      receipt.result.planDigest === request.payload.planDigest &&
      Date.parse(receipt.result.expiresAt) <= Date.parse(request.checkedAt)
    )
      key = null;
  }
  if (key === null) key = crypto.randomUUID();
  try {
    localStorage.setItem(identity, key);
    if (localStorage.getItem(identity) !== key) throw new Error(request.storageMessage);
  } catch {
    throw new Error(request.storageMessage);
  }
  return { method: "POST", body, headers: { "Idempotency-Key": key } };
}
