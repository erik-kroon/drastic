import * as Ar from "@open-erp/contracts/ar-legal-issue";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Policy from "@open-erp/contracts/legal-sales-policy";
import { equalJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Db from "../../db/commerce/ar-legal";
import * as Policies from "../../db/commerce/legal-policies";
import * as DraftDb from "../../db/commerce/invoice-lifecycle";
import * as Ledger from "../../db/posting";
import type { Transaction } from "../../db/transaction";
import { admitAccountRole } from "../resource-admission";
import { failure } from "../failures";
import { digest, isoNow, readBook, readPeriod } from "../posting";
import { calculateDraft } from "./draft-calculation";
import { toJsonObject, decode, requireRetainedEvidence, type Scope } from "./support";

type Accounts = {
  readonly controlAccountId: string;
  readonly revenueAccountId: string;
  readonly outputVatAccountId: string;
};

export const legalAccounts = Effect.fn("commerce.legalIssue.accounts")(function* (
  tx: Transaction,
  scope: Scope,
  input: Accounts,
) {
  const ids = [input.controlAccountId, input.revenueAccountId, input.outputVatAccountId];

  if (new Set(ids).size !== 3) return yield* failure("InvalidJournal");
  yield* admitAccountRole(tx, scope.bookId, input.controlAccountId, "commerce");
  const rows = yield* Ledger.readAccounts(tx, scope.bookId, ids);

  if (rows.length !== 3 || rows.some((a) => !a.active)) return yield* failure("InvalidJournal");

  for (const id of ids)
    if ((yield* DraftDb.readBankSourceAccount(tx, scope.bookId, id))[0]?.present)
      return yield* failure("InvalidJournal");

  if (
    (yield* DraftDb.readControlAccountConflict(
      tx,
      scope.bookId,
      input.controlAccountId,
      input.revenueAccountId,
    ))[0]?.conflict ||
    (yield* DraftDb.readControlAccountConflict(
      tx,
      scope.bookId,
      input.outputVatAccountId,
      input.outputVatAccountId,
    ))[0]?.conflict
  )
    return yield* failure("InvalidJournal");
});

export const calculateLegalIssue = Effect.fn("commerce.legalIssue.calculate")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Ar.PrepareArLegalIssue.Type,
) {
  const book = yield* readBook(tx, scope);

  if (
    book.profile !== "synthetic-core-v1" ||
    book.authority !== "native" ||
    book.currency !== "SEK" ||
    book.currencyScale !== 2
  )
    return yield* failure("UnsupportedProfile");
  const { policy, activation } = yield* readActivation(tx, scope, input);
  const head = (yield* DraftDb.readDraftHead(tx, scope.bookId, input.draftId))[0];

  if (!head) return yield* failure("NotFound");
  const draft = yield* decode(Drafts.InvoiceDraftRevision, head.body);

  if (draft.revision !== input.expectedRevision || draft.digest !== input.expectedDigest)
    return yield* failure("StaleDependency");

  if (
    (yield* DraftDb.readIssueForDraft(tx, scope.bookId, draft.id))[0]?.present ||
    (yield* Db.readArLegalIssueForDraft(tx, scope.bookId, draft.id))[0]?.present
  )
    return yield* failure("AlreadyPosted");

  const standing = new Set([
    "issuance_not_implemented",
    "legal_identity_not_verified",
    "tax_profile_not_activated",
  ]);

  if (draft.totals.sourceTotalMatches !== true || draft.blockers.some((b) => !standing.has(b.code)))
    return yield* failure("UnsupportedProfile");
  const calculation = yield* calculateDraft(tx, scope, book, draft.content);

  const current = {
    counterparty: calculation.counterparty,
    sellerEvidence: calculation.sellerEvidence,
    customerEvidence: calculation.customerEvidence,
    totals: calculation.totals,
    calculatedLines: calculation.calculatedLines,
    blockers: calculation.blockers,
  };

  const saved = {
    counterparty: head.body.counterparty ?? null,
    sellerEvidence: head.body.sellerEvidence ?? null,
    customerEvidence: head.body.customerEvidence ?? null,
    totals: head.body.totals ?? null,
    calculatedLines: head.body.calculatedLines ?? null,
    blockers: head.body.blockers ?? null,
  };

  if (!equalJson(current, saved)) return yield* failure("StaleDependency");

  yield* requireLegalIdentities(draft, policy);
  const period = yield* legalPeriod(tx, scope, draft, policy, input.accountingPeriodId);
  yield* legalAccounts(tx, scope, input);
  yield* requireRetainedEvidence(tx, scope.bookId, activation.input.accountRoleEvidence);
  const { lines, totals } = yield* calculateLines(draft, policy);

  return {
    draftSnapshot: draft,
    policySnapshot: policy,
    accountingProfileSnapshot: activation,
    lines,
    totals,
    fiscalYearId: period.fiscalYearId,
  };
});

export const checkedLegalIssue = Effect.fn("commerce.legalIssue.checked")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
  expected: string,
) {
  const row = (yield* Db.readArLegalIssueReview(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");
  const review = yield* decode(Ar.ArLegalIssueReview, row.body);
  const saved = review.digest;
  const body = { ...(yield* toJsonObject(review)) };
  delete body.digest;

  if (saved !== expected || (yield* digest(body)) !== saved)
    return yield* failure("StaleDependency");
  const calculation = yield* calculateLegalIssue(tx, scope, review.input);

  const captured = {
    draftSnapshot: review.draftSnapshot,
    policySnapshot: review.policySnapshot,
    accountingProfileSnapshot: review.accountingProfileSnapshot,
    lines: review.lines,
    totals: review.totals,
    fiscalYearId: review.fiscalYearId,
  };

  if (!equalJson(calculation, captured)) return yield* failure("StaleDependency");
  yield* requireRetainedEvidence(tx, scope.bookId, review.sourceEvidence);

  if (
    (yield* DraftDb.readPostedEvidenceHistory(
      tx,
      scope.bookId,
      review.sourceEvidence.evidenceId,
    ))[0]?.present
  )
    return yield* failure("AlreadyPosted");

  return review;
});

const readActivation = Effect.fn("commerce.legalIssue.activation")(function* (
  tx: Transaction,
  scope: Scope,
  input: typeof Ar.PrepareArLegalIssue.Type,
) {
  const policyRow = (yield* Policies.readPolicy(tx, scope.bookId, input.policyId))[0];

  if (!policyRow) return yield* failure("UnsupportedProfile");
  const policy = yield* decode(Policy.LegalSalesPolicy, policyRow.body);

  if (
    policy.digest !== input.policyDigest ||
    policy.status !== "active" ||
    policy.input.ruleVersion !== "se-domestic-standard-25-2023-200-v1" ||
    policy.candidate.input.vatTreatment !== "se-domestic-standard-25-v1" ||
    policy.candidate.input.roundingMethod !== "line-tax-half-up-minor-v1"
  )
    return yield* failure("UnsupportedProfile");

  const activationRow = (yield* Db.readArLegalAccountingProfile(
    tx,
    scope.bookId,
    input.accountingProfileId,
  ))[0];

  if (!activationRow) return yield* failure("UnsupportedProfile");
  const activation = yield* decode(Ar.ArLegalAccountingProfile, activationRow.body);

  if (
    activation.policyId !== policy.id ||
    activation.digest !== input.accountingProfileDigest ||
    activation.status !== "active" ||
    activation.input.controlAccountId !== input.controlAccountId ||
    activation.input.revenueAccountId !== input.revenueAccountId ||
    activation.input.outputVatAccountId !== input.outputVatAccountId
  )
    return yield* failure("UnsupportedProfile");

  return { policy, activation };
});

const requireLegalIdentities = Effect.fn("commerce.legalIssue.identities")(function* (
  draft: typeof Drafts.InvoiceDraftRevision.Type,
  policy: typeof Policy.LegalSalesPolicy.Type,
) {
  const { seller, customer } = draft.content,
    identity = policy.candidate.input.sellerIdentity;

  if (
    seller.legalName !== identity.legalName ||
    seller.registrationId !== identity.registrationNumber ||
    seller.taxId !== identity.vatRegistrationNumber ||
    seller.address !== identity.postalAddress ||
    seller.countryCode !== "SE" ||
    customer.countryCode !== "SE" ||
    !/^[0-9]{6}-?[0-9]{4}$/.test(customer.registrationId ?? "") ||
    customer.legalName !== draft.counterparty.displayName ||
    customer.evidenceId !== draft.counterparty.evidenceId ||
    !customer.address ||
    draft.sellerEvidence.evidenceId !== policy.candidate.input.sellerEvidence.evidenceId
  )
    return yield* failure("UnsupportedProfile");
});

const legalPeriod = Effect.fn("commerce.legalIssue.period")(function* (
  tx: Transaction,
  scope: Scope,
  draft: typeof Drafts.InvoiceDraftRevision.Type,
  policy: typeof Policy.LegalSalesPolicy.Type,
  accountingPeriodId: string,
) {
  const issueDate = draft.content.plannedIssueDate,
    supplyDate = draft.content.supplyDate,
    effective = policy.candidate.input.effectiveFrom;

  if (
    issueDate === null ||
    supplyDate === null ||
    draft.content.currency !== "SEK" ||
    draft.content.currencyScale !== 2 ||
    issueDate !== (yield* isoNow(tx)).slice(0, 10) ||
    issueDate < effective ||
    supplyDate < effective ||
    supplyDate > issueDate
  )
    return yield* failure("UnsupportedProfile");
  const period = yield* readPeriod(tx, scope, accountingPeriodId);

  if (
    period.locked ||
    issueDate < period.startsOn ||
    issueDate > period.endsOn ||
    issueDate < period.fiscalYear.startsOn ||
    issueDate > period.fiscalYear.endsOn
  )
    return yield* failure("PeriodLocked");

  return period;
});

const calculateLines = Effect.fn("commerce.legalIssue.lines")(function* (
  draft: typeof Drafts.InvoiceDraftRevision.Type,
  policy: typeof Policy.LegalSalesPolicy.Type,
) {
  const lines: Array<(typeof Ar.ArLegalIssueReview.Type.lines)[number]> = [];

  let netTotal = 0n,
    taxTotal = 0n,
    grossTotal = 0n;

  for (const line of draft.content.lines) {
    const base = BigInt(line.baseMinor),
      net = base - BigInt(line.discountMinor) + BigInt(line.chargeMinor);

    if (
      line.unitPriceMinor === null ||
      net <= 0n ||
      net >= 10n ** 38n ||
      line.taxDescription !== "se-domestic-standard-25-v1" ||
      line.taxEvidenceId !== policy.candidate.input.vatEvidence.evidenceId
    )
      return yield* failure("UnsupportedProfile");

    const tax = (net * 25n + 50n) / 100n,
      gross = net + tax;

    if (
      tax <= 0n ||
      gross >= 10n ** 38n ||
      line.taxMinor !== tax.toString() ||
      line.sourceGrossMinor !== gross.toString()
    )
      return yield* failure("UnsupportedProfile");
    lines.push({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      baseMinor: line.baseMinor,
      discountMinor: line.discountMinor,
      chargeMinor: line.chargeMinor,
      netMinor: net.toString(),
      taxMinor: tax.toString(),
      grossMinor: gross.toString(),
      vatTreatment: "se-domestic-standard-25-v1",
    });
    netTotal += net;
    taxTotal += tax;
    grossTotal += gross;
  }

  if (
    grossTotal >= 10n ** 38n ||
    draft.totals.netMinor !== netTotal.toString() ||
    draft.totals.taxMinor !== taxTotal.toString() ||
    draft.totals.grossMinor !== grossTotal.toString() ||
    draft.content.sourceTotalMinor !== grossTotal.toString()
  )
    return yield* failure("InvalidJournal");

  return {
    lines,
    totals: {
      netMinor: netTotal.toString(),
      taxMinor: taxTotal.toString(),
      grossMinor: grossTotal.toString(),
    },
  };
});
