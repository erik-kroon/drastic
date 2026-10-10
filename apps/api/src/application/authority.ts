import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Presence from "@open-erp/contracts/presence";
import * as Effect from "effect/Effect";
import * as Db from "../db/presence";
import type { VerifiedPrincipal } from "../db/identity";
import type { Transaction } from "../db/transaction";
import { failure } from "./failures";
import { digest } from "./json";

// The separate powers of docs/plans/00-shared-contracts.md#human-and-machine-authority.
// A power names what an action can do to the books or the outside world; the
// gesture table below decides what must stand behind each action that uses it.
export type Power =
  | "prepare"
  | "record"
  | "approve_change"
  | "issue_document"
  | "settle"
  | "authorize_payment"
  | "sign"
  | "submit_filing"
  | "activate_rule"
  | "administer_membership"
  | "configure_book"
  | "provider_callback";

// What authorized the caller to act. A browser session and an API credential are
// how the actor authenticated; neither proves that a person made this decision.
export type Basis = "interactive_session" | "machine_credential";

type Gesture = {
  readonly power: Power;
  readonly basis: Basis;
  readonly refusal: "Forbidden" | "ApprovalRequired";
  // The book's authority policy may additionally require a presence proof bound
  // to the exact request (ADR 0020).
  readonly presence?: true;
};

type Authenticated = { readonly kind: "apiCredential" | "betterAuthSession" | "oauthGrant" };

const session = (power: Power, refusal: Gesture["refusal"] = "Forbidden") =>
  ({ power, basis: "interactive_session", refusal }) as const;

const present = (power: Power, refusal: Gesture["refusal"] = "Forbidden") =>
  ({ power, basis: "interactive_session", refusal, presence: true }) as const;

const machine = (power: Power) =>
  ({ power, basis: "machine_credential", refusal: "Forbidden" }) as const;

// Every authentication-kind gate in the application. Operator membership remains
// the book-role gate in db/identity.ts and is not repeated here. A gesture that is
// absent from this table needs no particular basis beyond its book admission.
//
// The current posture is recorded as found, including where one power is gated
// differently between families (for example approve_change is session-only here
// but admits an operator API credential through approveChangeInTransaction).
// Align a power by editing this table, not by adding a check at the call site.
const gestures = {
  // Posting-family approvals that require a browser session.
  approve_historical_settlement: session("approve_change"),
  approve_historical_adoption: session("approve_change"),
  rereview_historical_pool: session("approve_change"),
  approve_foreign_cash: session("approve_change"),
  approve_processor_clearing: session("approve_change"),
  return_processor_review: session("approve_change"),
  return_peppol_review: session("approve_change"),
  approve_proceeds_disposal: session("approve_change"),
  approve_employee_claim: session("approve_change"),
  approve_variable_input: session("approve_change"),
  review_filing_adoption: session("approve_change"),
  review_document_governance: session("approve_change"),

  // Commercial documents and their delivery.
  approve_reminder: session("issue_document"),
  request_reminder_dispatch: session("issue_document"),
  cancel_reminder: session("issue_document"),
  replace_reminder: session("issue_document"),
  reconcile_reminder: session("issue_document"),
  approve_ar_legal_issue: session("issue_document"),
  approve_legal_delivery: session("issue_document"),
  start_legal_delivery_attempt: session("issue_document"),
  reconcile_legal_delivery_attempt: session("issue_document"),
  approve_peppol_exchange: session("issue_document"),
  approve_customer_credit: session("issue_document"),

  // Payment and settlement authority.
  approve_payroll_settlement_instruction: present("authorize_payment", "ApprovalRequired"),
  cancel_payroll_adjustment_instruction: session("authorize_payment", "ApprovalRequired"),
  verify_employee_payee: present("authorize_payment"),
  approve_claim_payment_file: present("authorize_payment"),
  approve_claim_settlement: session("settle"),

  // Signatures and statutory filings.
  prepare_document_signature: present("sign"),
  operate_document_signature: session("sign"),
  authorize_filing: present("submit_filing"),
  operate_filing: session("submit_filing"),

  // Rules, setup and membership.
  activate_ar_legal_profile: session("activate_rule"),
  grant_posting_mandate: present("activate_rule"),
  // Presence ceremonies themselves need a person at a browser.
  request_presence_challenge: session("prepare"),
  initialize_native_ledger: session("configure_book"),
  save_firm_client: session("administer_membership"),
  remove_firm_client: session("administer_membership"),
  request_claim_completion: session("record"),
  write_variable_pay_review: session("prepare"),

  // Delivery workers and provider callbacks run under a dedicated credential.
  dispatch_reminder: machine("provider_callback"),
  retain_reminder_outcome: machine("provider_callback"),
  stop_reminder_delivery: machine("provider_callback"),
  run_decision_request: machine("provider_callback"),
  publish_decision_result: machine("provider_callback"),
  run_supplier_extraction: machine("provider_callback"),
  publish_supplier_extraction: machine("provider_callback"),
  stop_supplier_extraction_delivery: machine("provider_callback"),
  retain_signature_observation: machine("provider_callback"),
  retain_filing_observation: machine("provider_callback"),
} as const satisfies Record<string, Gesture>;

export type GestureName = keyof typeof gestures;

type PresenceName = {
  [N in GestureName]: (typeof gestures)[N] extends { readonly presence: true } ? N : never;
}[GestureName];

// A presence gesture must go through authorizePresent with its exact request.
type DirectName = Exclude<GestureName, PresenceName>;

// The contract's presence gestures and this table's must name the same set.
const presenceNames = {
  approve_payroll_settlement_instruction: "approve_payroll_settlement_instruction",
  verify_employee_payee: "verify_employee_payee",
  approve_claim_payment_file: "approve_claim_payment_file",
  prepare_document_signature: "prepare_document_signature",
  authorize_filing: "authorize_filing",
  grant_posting_mandate: "grant_posting_mandate",
} as const satisfies Record<typeof Presence.PresenceGesture.Type, PresenceName>;

const proofUseWindowSeconds = 300;

type KindFor<B extends Basis> = B extends "interactive_session"
  ? "betterAuthSession"
  : "apiCredential";

type Admitted<P extends Authenticated, N extends GestureName> = Extract<
  P,
  { readonly kind: KindFor<(typeof gestures)[N]["basis"]> }
>;

function basisOf(principal: Authenticated): Basis {
  return principal.kind === "betterAuthSession" ? "interactive_session" : "machine_credential";
}

function hasBasis<P extends Authenticated, N extends GestureName>(
  principal: P,
  name: N,
): principal is Admitted<P, N> {
  return principal.kind !== "oauthGrant" && basisOf(principal) === gestures[name].basis;
}

// Whether the authenticated principal may perform the gesture. Use for derived
// read flags (for example whether a view offers an approval action) and to
// re-read how a retained approver authenticated.
export function permits(principal: Authenticated, name: GestureName): boolean {
  return hasBasis(principal, name);
}

// Refuse the gesture unless the principal has the declared basis, and return the
// principal narrowed to that basis. The caller still owns book admission, operator
// membership and every financial check.
export function authorize<P extends Authenticated, N extends DirectName>(principal: P, name: N) {
  return hasBasis(principal, name) ? Effect.succeed(principal) : failure(gestures[name].refusal);
}

export function presenceGesture(name: typeof Presence.PresenceGesture.Type) {
  return presenceNames[name];
}

export function readAuthorityPolicy(transaction: Transaction, bookId: string) {
  return Db.readAuthorityPolicy(transaction, bookId).pipe(
    Effect.map((rows) => rows[0] ?? { presenceRequired: false, postingMandatesEnabled: false }),
  );
}

// The digest a presence challenge and the guarded gesture must agree on.
export function presenceBinding(
  name: PresenceName,
  bookId: string,
  actorId: string,
  subject: typeof Presence.PresenceSubject.Type,
) {
  return digest({ version: 1, gesture: name, bookId, actorId, subject });
}

// Refuse the gesture unless the principal has the declared basis and, when the
// book's policy requires it, a verified presence proof for this exact request
// from the same session. A fresh proof is consumed in the caller's transaction,
// so it rolls back with the gesture. A proof already consumed for the same
// binding admits an unchanged replay, whose own receipt returns the recorded
// result; the idempotency key is part of the binding.
export function authorizePresent(
  transaction: Transaction,
  principal: VerifiedPrincipal,
  scope: typeof Accounting.Scope.Type,
  name: PresenceName,
  subject: typeof Presence.PresenceSubject.Type,
) {
  return Effect.gen(function* () {
    // Every presence gesture is an interactive-session gesture.
    if (principal.kind !== "betterAuthSession") return yield* failure(gestures[name].refusal);

    const policy = yield* readAuthorityPolicy(transaction, scope.bookId);

    if (!policy.presenceRequired) return principal;

    const proofs = yield* Db.readProofs(transaction, {
      actorId: principal.actorId,
      bookId: scope.bookId,
      sessionId: principal.sessionId,
      gesture: name,
      bindingDigest: yield* presenceBinding(name, scope.bookId, principal.actorId, subject),
      useWindowSeconds: proofUseWindowSeconds,
    });

    const proof = proofs[0];

    if (proof === undefined) return yield* failure("PresenceRequired");

    if (!proof.consumed) yield* Db.insertConsumption(transaction, proof.challengeId);

    return principal;
  });
}
