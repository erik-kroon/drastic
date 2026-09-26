import * as Accounting from "@open-erp/contracts/accounting";
import * as Vat from "@open-erp/contracts/vat-returns";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Db from "../../db/posting";
import { databaseFailure, type Transaction } from "../../db/transaction";
import * as ReclassDb from "../../db/vat/reclassification";
import * as VatDb from "../../db/vat/returns";
import { decode, toJsonObject, unsupported, type JsonObject, type Principal, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode } from "../identity";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { digestBody, digestValue, readCurrentFactObservations } from "./basis";

type ReclassificationInput = typeof Vat.PrepareVatControlReclassification.Type;
type Draft = typeof Vat.VatDraft.Type;
type Observation = typeof Vat.VatFactObservation.Type;
type Assessment = typeof Vat.VatAssessment.Type;
type Contribution = typeof Vat.VatControlContribution.Type;
type Action = typeof Accounting.VoucherPostingAction.Type;
type VatRole = "output_vat_control" | "input_vat_control";
type ControlRole = VatRole | "vat_settlement_control";

const BasisSchema = Vat.VatControlReclassificationBasis;
const ReviewSchema = Vat.VatControlReclassificationReview;
const DomainApprovalSchema = Vat.VatControlReclassificationApproval;
const EffectSchema = Vat.VatControlReclassificationEffect;
const ViewSchema = Vat.VatControlReclassificationView;
const ListSchema = Vat.VatControlReclassificationList;
const ActionSchema = Accounting.VoucherPostingAction;
const PlanSchema = Accounting.ChangeSet;
const ReceiptSchema = Accounting.ExecutionReceipt;
const GroupReceiptSchema = Accounting.GroupReceipt;
const KernelApprovalSchema = Accounting.Approval;

const profileName = "vat_control_reclassification_v1";
const profileVersion = "1";
const scheme = "synthetic_output_input_v1";
const registrationId = "synthetic_registration";
const reviewBound = 500;
const obligationReviewBound = 20;
const profileBound = 20;
const obligationBound = 200;
const approvalBound = 20;
const contributionBound = 500;
const contributionInventoryBound = 5000;
const postingLineBound = 500;
const approvalLifetimeMs = 60 * 60 * 1000;

const roleBindings: ReadonlyArray<{
  readonly role: ControlRole;
  readonly key: "outputAccountId" | "inputAccountId" | "settlementAccountId";
}> = [
  { role: "output_vat_control", key: "outputAccountId" },
  { role: "input_vat_control", key: "inputAccountId" },
  { role: "vat_settlement_control", key: "settlementAccountId" },
];

const writableTables = new Set([
  "vat_control_profiles",
  "vat_control_account_roles",
  "vat_reporting_obligations",
  "vat_control_reclassification_reviews",
  "vat_control_reclassification_approvals",
  "vat_control_reclassification_effects",
  "vat_control_reclassification_contributions",
  "change_sets",
  "command_receipts",
]);

function withVatBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function sameJson(left: Schema.Json, right: Schema.Json) {
  const first = canonicalizeJson(left);
  const second = canonicalizeJson(right);
  if (Result.isFailure(first) || Result.isFailure(second)) return false;
  return first.success.json === second.success.json;
}

function shortDigest(transaction: Transaction, value: JsonObject) {
  return digestValue(transaction, value).pipe(Effect.map((digest) => digest.slice(8, 40)));
}

function requireReclassificationAccess(transaction: Transaction, write: boolean) {
  return VatDb.readReclassificationAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== VatDb.reclassificationTables.length) return unsupported();
      const denied = rows.some((row) => {
        if (!row.canSelect) return true;
        return write && writableTables.has(row.tableName) && !row.canInsert;
      });
      return denied ? unsupported() : Effect.void;
    }),
  );
}

function withinInterval(value: string | null, startsOn: string, endsOn: string) {
  return value === null || (value >= startsOn && value <= endsOn);
}

function isCalendarDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function minor(value: string) {
  return BigInt(value);
}

function textField(value: JsonObject, key: string) {
  const found = value[key];
  return typeof found === "string" ? found : null;
}

function readControlAccounts(
  transaction: Transaction,
  scope: Scope,
  input: ReclassificationInput,
  create: boolean,
) {
  return Effect.gen(function* () {
    const roleEvidence = yield* Db.readEvidence(transaction, scope.bookId, input.roleEvidenceId);
    const roleSha = roleEvidence[0]?.sha256;
    if (roleSha === undefined) return yield* failure("MissingEvidence");
    const selected = [input.outputAccountId, input.inputAccountId, input.settlementAccountId];
    if (new Set(selected).size !== selected.length) return yield* failure("InvalidJournal");
    const accounts = yield* ReclassDb.readAccountStateRows(transaction, scope.bookId, selected);
    if (accounts.length !== selected.length || accounts.some((account) => !account.active)) {
      return yield* failure("StaleDependency");
    }
    if ((yield* ReclassDb.readAccountRoleConflicts(transaction, scope.bookId, selected))[0]?.conflict) {
      return yield* failure("InvalidJournal");
    }
    if (
      (yield* ReclassDb.readRetainedAccountOwners(transaction, scope.bookId, selected))[0]?.conflict
    ) {
      return yield* failure("InvalidJournal");
    }
    const states = new Map(accounts.map((account) => [account.id, account]));
    const accountRoles: Array<{
      readonly role: ControlRole;
      readonly accountId: string;
      readonly accountVersion: string;
      readonly code: string;
      readonly name: string;
      readonly active: boolean;
    }> = [];
    for (const binding of roleBindings) {
      const account = states.get(input[binding.key]);
      if (account === undefined) return yield* failure("StaleDependency");
      accountRoles.push({
        role: binding.role,
        accountId: account.id,
        accountVersion: account.version,
        code: account.code,
        name: account.name,
        active: account.active,
      });
    }
    const identity = yield* digestValue(transaction, {
      profile: profileName,
      profileVersion,
      roleEvidenceId: input.roleEvidenceId,
      accountRoles,
    });
    const existing = (yield* VatDb.readControlProfile(transaction, scope.bookId, identity))[0];
    if (existing === undefined && !create) return yield* failure("StaleDependency");
    if (existing !== undefined) {
      const retained = yield* VatDb.readControlAccountRoles(transaction, scope.bookId, existing.id);
      if (!sameJson(retained, accountRoles)) {
        return yield* failure("StaleDependency");
      }
      return {
        profileId: existing.id,
        profile: yield* decode(BasisSchema.fields.profile, existing.body),
        accountRoles,
      };
    }
    const count = yield* VatDb.countRows(transaction, "vat_control_profiles", scope.bookId);
    if ((count[0]?.total ?? 0) >= profileBound) return yield* unsupported();
    const profileId = newId("vatprofile");
    const body = yield* digestBody(transaction, {
      id: profileId,
      profile: profileName,
      profileVersion,
      jurisdiction: "SE",
      scheme,
      evidenceSha256: roleSha,
    });
    yield* VatDb.insertControlProfile(transaction, {
      bookId: scope.bookId,
      id: profileId,
      identityKey: identity,
      roleEvidenceId: input.roleEvidenceId,
      body,
    });
    yield* VatDb.insertControlAccountRoles(
      transaction,
      accountRoles.map((binding) => ({
        bookId: scope.bookId,
        profileId,
        role: binding.role,
        accountId: binding.accountId,
        accountVersion: binding.accountVersion,
        code: binding.code,
        name: binding.name,
        active: binding.active,
      })),
    );
    return {
      profileId,
      profile: yield* decode(BasisSchema.fields.profile, body),
      accountRoles,
    };
  });
}

function readObligation(
  transaction: Transaction,
  scope: Scope,
  draft: Draft,
  create: boolean,
) {
  return Effect.gen(function* () {
    let periodEvidenceSha256: string | null = null;
    if (draft.input.periodEvidenceId !== null) {
      const evidence = yield* Db.readEvidence(transaction, scope.bookId, draft.input.periodEvidenceId);
      periodEvidenceSha256 = evidence[0]?.sha256 ?? null;
      if (periodEvidenceSha256 === null || periodEvidenceSha256 !== draft.periodEvidenceSha256) {
        return yield* failure("StaleDependency");
      }
    }
    const existing = (
      yield* VatDb.readReportingObligation(
        transaction,
        scope.bookId,
        draft.input.startsOn,
        draft.input.endsOn,
      )
    )[0];
    if (existing !== undefined) {
      if (
        existing.periodEvidenceSha256 !== periodEvidenceSha256 ||
        textField(existing.body, "periodEvidenceId") !== draft.input.periodEvidenceId
      ) {
        return yield* failure("StaleDependency");
      }
      return yield* decode(BasisSchema.fields.obligation, existing.body);
    }
    if (!create) return yield* failure("StaleDependency");
    const count = yield* VatDb.countRows(transaction, "vat_reporting_obligations", scope.bookId);
    if ((count[0]?.total ?? 0) >= obligationBound) return yield* unsupported();
    const id = newId("vatobligation");
    const body = yield* digestBody(transaction, {
      id,
      registrationNamespace: "synthetic",
      registrationId,
      jurisdiction: "SE",
      scheme,
      startsOn: draft.input.startsOn,
      endsOn: draft.input.endsOn,
      periodEvidenceId: draft.input.periodEvidenceId,
    });
    yield* VatDb.insertReportingObligation(transaction, {
      bookId: scope.bookId,
      id,
      startsOn: draft.input.startsOn,
      endsOn: draft.input.endsOn,
      periodEvidenceId: draft.input.periodEvidenceId,
      periodEvidenceSha256,
      body,
      digest: textField(body, "digest") ?? "",
    });
    return yield* decode(BasisSchema.fields.obligation, body);
  });
}

function readSelectedDraft(
  transaction: Transaction,
  scope: Scope,
  input: ReclassificationInput,
) {
  return Effect.gen(function* () {
    const row = (yield* VatDb.readRetainedDraft(transaction, scope.bookId, input.draftId))[0];
    if (row === undefined) return yield* failure("NotFound");
    const draft = yield* decode(Vat.VatDraft, row.body);
    if (draft.digest !== input.expectedDraftDigest || !sameJson(draft.scope, scope)) {
      return yield* failure("StaleDependency");
    }
    if (
      draft.input.mode !== "synthetic_demonstration" ||
      draft.input.otherBoxes !== "absent_in_synthetic_example" ||
      draft.calculation.engine !== "vat-return-draft-v3" ||
      draft.basis.bookProfile !== "synthetic-core-v1" ||
      draft.basis.currency !== "SEK" ||
      draft.basis.currencyScale !== 2 ||
      draft.calculation.syntheticBoxes === null
    ) {
      return yield* unsupported();
    }
    return draft;
  });
}

function requireCompleteLineage(draft: Draft) {
  const facts = draft.basis.facts;
  const assessments = draft.calculation.assessments;
  if (
    facts.length > 200 ||
    facts.length !== assessments.length ||
    new Set(facts.map((observation) => observation.fact.factId)).size !== facts.length ||
    new Set(assessments.map((assessment) => assessment.factId)).size !== facts.length
  ) {
    return unsupported();
  }
  for (const [index, observation] of facts.entries()) {
    const assessment = assessments[index];
    if (
      assessment === undefined ||
      assessment.factId !== observation.fact.factId ||
      assessment.sourceDigest !== observation.fact.digest
    ) {
      return unsupported();
    }
  }
  return Effect.void;
}

function requireIncludedAssessment(assessment: Assessment) {
  if (
    assessment.state !== "included_synthetic" ||
    assessment.blockers.length !== 0 ||
    assessment.contribution === null ||
    assessment.sourceDifferenceMinor !== "0" ||
    assessment.rateDifferenceNumerator !== "0" ||
    assessment.ledgerDifferenceMinor !== "0" ||
    assessment.ledgerTaxMinor === null
  ) {
    return failure("StaleDependency");
  }
  return Effect.void;
}

function requireExactSource(facts: typeof Vat.VatFactInput.Type) {
  return minor(facts.grossMinor) - minor(facts.netMinor) - minor(facts.vatMinor) === 0n &&
    minor(facts.vatMinor) * 4n - minor(facts.netMinor) === 0n
    ? Effect.void
    : failure("StaleDependency");
}

function requireMatchingContribution(
  assessment: Assessment,
  role: VatRole,
  facts: typeof Vat.VatFactInput.Type,
) {
  const contribution = assessment.contribution;
  if (contribution === null) return failure("StaleDependency");
  const matches =
    role === "output_vat_control"
      ? contribution.box05Minor === facts.netMinor &&
        contribution.box10Minor === facts.vatMinor &&
        contribution.box48Minor === "0"
      : contribution.box05Minor === "0" &&
        contribution.box10Minor === "0" &&
        contribution.box48Minor === facts.vatMinor;
  return matches ? Effect.void : failure("StaleDependency");
}

function requirePostedTaxLineBasis(observation: Observation, startsOn: string, endsOn: string) {
  const selected = observation.fact.input.taxLineIds;
  if (
    observation.fact.input.voucherId === null ||
    selected.length === 0 ||
    new Set(selected).size !== selected.length ||
    observation.taxLines.length !== selected.length ||
    observation.taxLines.some((line) => !selected.includes(line.id)) ||
    (observation.withdrawal ?? null) !== null ||
    observation.expenseSourceWithdrawn === true ||
    observation.expenseLinkCurrent !== true ||
    observation.voucherReversed !== false ||
    !withinInterval(observation.voucherPostingDate, startsOn, endsOn)
  ) {
    return failure("StaleDependency");
  }
  return Effect.void;
}

type RelevantFact = {
  readonly factId: string;
  readonly input: typeof Vat.VatFactInput.Type;
  readonly assessment: Assessment;
  readonly role: VatRole;
  readonly accountId: string;
  readonly observation: Observation;
};

function readRelevantFacts(
  transaction: Transaction,
  scope: Scope,
  draft: Draft,
  input: ReclassificationInput,
) {
  return Effect.gen(function* () {
    const startsOn = draft.input.startsOn;
    const endsOn = draft.input.endsOn;
    const current = yield* readCurrentFactObservations(transaction, scope.bookId);
    const currentByFactId = new Map(
      current.map((observation) => [observation.fact.factId, observation]),
    );
    const relevant: Array<RelevantFact> = [];
    for (const [index, saved] of draft.basis.facts.entries()) {
      const assessment = draft.calculation.assessments[index];
      if (assessment === undefined) return yield* unsupported();
      const observed = currentByFactId.get(saved.fact.factId);
      const savedRelevant = withinInterval(saved.fact.input.taxPointOn, startsOn, endsOn);
      const currentRelevant =
        observed !== undefined && withinInterval(observed.fact.input.taxPointOn, startsOn, endsOn);
      if (!savedRelevant && !currentRelevant) continue;
      if (
        observed === undefined ||
        savedRelevant !== currentRelevant ||
        !sameJson(observed, saved)
      ) {
        return yield* failure("StaleDependency");
      }
      yield* requireIncludedAssessment(assessment);
      const facts = saved.fact.input;
      if (
        facts.recordClass !== "synthetic" ||
        (facts.treatment !== "domestic_sale" && facts.treatment !== "domestic_purchase")
      ) {
        return yield* unsupported();
      }
      const role: VatRole =
        facts.treatment === "domestic_sale" ? "output_vat_control" : "input_vat_control";
      yield* requireExactSource(facts);
      yield* requireMatchingContribution(assessment, role, facts);
      yield* requirePostedTaxLineBasis(observed, startsOn, endsOn);
      relevant.push({
        factId: saved.fact.factId,
        input: facts,
        assessment,
        role,
        accountId: role === "output_vat_control" ? input.outputAccountId : input.inputAccountId,
        observation: observed,
      });
    }
    return { relevant, current, startsOn, endsOn };
  });
}

function readContributions(
  transaction: Transaction,
  scope: Scope,
  relevant: ReadonlyArray<RelevantFact>,
  startsOn: string,
  endsOn: string,
  committedSequence: string,
) {
  return Effect.gen(function* () {
    const contributions: Array<Contribution> = [];
    const sourceStates: Array<JsonObject> = [];
    const pairs: Array<{ readonly voucherId: string; readonly lineId: string }> = [];
    let latestSourceDate = "";
    for (const item of relevant) {
      const voucherId = item.observation.fact.input.voucherId;
      if (voucherId === null) return yield* failure("StaleDependency");
      const voucher = (yield* ReclassDb.readSourceVoucher(transaction, scope.bookId, voucherId))[0];
      const corrections = yield* ReclassDb.readCorrectionVoucherIds(
        transaction,
        scope.bookId,
        voucherId,
      );
      if (
        voucher === undefined ||
        minor(voucher.sequence) > minor(committedSequence) ||
        voucher.postingPurpose === "reversal" ||
        voucher.postingPurpose === "vat_control_reclassification_v1" ||
        !withinInterval(voucher.postingDate, startsOn, endsOn) ||
        corrections.length > 0
      ) {
        return yield* failure("StaleDependency");
      }
      if (voucher.postingDate > latestSourceDate) latestSourceDate = voucher.postingDate;
      const collected = yield* readFactContributions(
        transaction,
        scope,
        item,
        voucher.id,
        voucher.sequence,
        voucher.postingDate,
        voucher.eventId,
        voucher.postingPurpose,
        voucher.correctsVoucherId,
        voucher.changeSetId,
        voucher.action,
        corrections.map((correction) => correction.id),
        contributions,
      );
      for (const entry of collected.contributions) contributions.push(entry);
      for (const state of collected.sourceStates) sourceStates.push(state);
      for (const pair of collected.pairs) pairs.push(pair);
    }
    if (pairs.length > 0) {
      const claims = yield* ReclassDb.readClaimedLineRows(transaction, scope.bookId, pairs);
      if (claims.length !== pairs.length || claims.some((claim) => claim.claimed)) {
        return yield* failure("InvalidJournal");
      }
    }
    return { contributions, sourceStates, latestSourceDate };
  });
}

function readFactContributions(
  transaction: Transaction,
  scope: Scope,
  item: RelevantFact,
  voucherId: string,
  sequence: string,
  postingDate: string,
  eventId: string,
  postingPurpose: string,
  correctsVoucherId: string | null,
  changeSetId: string,
  action: JsonObject,
  correctionVoucherIds: ReadonlyArray<string>,
  existing: ReadonlyArray<Contribution>,
) {
  return Effect.gen(function* () {
    const pairs: Array<{ readonly voucherId: string; readonly lineId: string }> = [];
    const contributions: Array<Contribution> = [];
    const sourceStates: Array<JsonObject> = [];
    let ledgerTax = 0n;
    const ordered = [...item.observation.taxLines].sort((left, right) =>
      left.id === right.id ? 0 : left.id < right.id ? -1 : 1,
    );
    for (const taxLine of ordered) {
      const account = (
        yield* ReclassDb.readAccountStateRows(transaction, scope.bookId, [taxLine.accountId])
      )[0];
      const line = (yield* ReclassDb.readSourceLine(transaction, scope.bookId, voucherId, taxLine.id))[0];
      if (account === undefined || line === undefined) return yield* failure("StaleDependency");
      if (!matchesTaxLineRole(item, line, account.active)) {
        return yield* failure("InvalidJournal");
      }
      if (
        existing.some((entry) => entry.voucherId === voucherId && entry.lineId === taxLine.id)
      ) {
        return yield* failure("InvalidJournal");
      }
      pairs.push({ voucherId, lineId: taxLine.id });
      const balance = minor(line.debitMinor) - minor(line.creditMinor);
      ledgerTax +=
        item.role === "output_vat_control"
          ? minor(line.creditMinor) - minor(line.debitMinor)
          : minor(line.debitMinor) - minor(line.creditMinor);
      contributions.push({
        factId: item.factId,
        factRevisionId: item.observation.fact.id,
        factRevision: item.observation.fact.revision,
        factDigest: item.observation.fact.digest,
        voucherId,
        lineId: taxLine.id,
        role: item.role,
        accountId: line.accountId,
        accountVersion: account.version,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        balanceMinor: balance.toString(),
      });
      sourceStates.push({
        factId: item.factId,
        voucher: {
          id: voucherId,
          sequence,
          postingDate,
          eventId,
          postingPurpose,
          correctsVoucherId,
          changeSetId,
          action,
        },
        line: {
          id: line.id,
          ordinal: line.ordinal,
          accountId: line.accountId,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          description: line.description,
        },
        correctionVoucherIds,
      });
    }
    if (
      ledgerTax !== minor(item.input.vatMinor) ||
      item.assessment.ledgerTaxMinor !== ledgerTax.toString()
    ) {
      return yield* failure("StaleDependency");
    }
    return { pairs, contributions, sourceStates };
  });
}

function matchesTaxLineRole(
  item: RelevantFact,
  line: { accountId: string; debitMinor: string; creditMinor: string },
  accountActive: boolean,
) {
  if (line.accountId !== item.accountId || !accountActive) return false;
  const debit = minor(line.debitMinor);
  const credit = minor(line.creditMinor);
  if (item.role === "output_vat_control") return debit === 0n && credit > 0n;
  return debit > 0n && credit === 0n;
}

function requireCompleteRoleLedger(
  transaction: Transaction,
  scope: Scope,
  input: ReclassificationInput,
  contributions: ReadonlyArray<Contribution>,
  startsOn: string,
  endsOn: string,
  committedSequence: string,
) {
  return Effect.gen(function* () {
    const roleLedger = (
      yield* ReclassDb.readRoleLedger(
        transaction,
        scope.bookId,
        [input.outputAccountId, input.inputAccountId, input.settlementAccountId],
        startsOn,
        endsOn,
        committedSequence,
      )
    ).map((row) => row.item);
    const contributed = new Set(contributions.map((entry) => `${entry.voucherId}:${entry.lineId}`));
    for (const item of roleLedger) {
      const accountId = item.accountId;
      const voucherId = item.voucherId;
      const lineId = item.lineId;
      if (
        typeof accountId !== "string" ||
        typeof voucherId !== "string" ||
        typeof lineId !== "string"
      ) {
        return yield* failure("InternalError");
      }
      if (accountId === input.settlementAccountId) return yield* failure("StaleDependency");
      if (
        (accountId === input.outputAccountId || accountId === input.inputAccountId) &&
        !contributed.has(`${voucherId}:${lineId}`)
      ) {
        return yield* failure("StaleDependency");
      }
    }
    return roleLedger;
  });
}

function readBoxTotals(draft: Draft, relevant: ReadonlyArray<RelevantFact>) {
  return Effect.gen(function* () {
    const assessments = draft.calculation.assessments;
    const included = assessments.filter((assessment) => assessment.contribution !== null);
    if (
      draft.calculation.includedCount !== included.length ||
      draft.calculation.excludedCount !== assessments.length - included.length
    ) {
      return yield* unsupported();
    }
    const sum = (key: "box05Minor" | "box10Minor" | "box48Minor") =>
      included.reduce(
        (total, assessment) => total + minor(assessment.contribution?.[key] ?? "0"),
        0n,
      );
    const boxes = draft.calculation.syntheticBoxes;
    if (boxes === null) return yield* unsupported();
    if (
      minor(boxes.box10.exactMinor) !== sum("box10Minor") ||
      minor(boxes.box48.exactMinor) !== sum("box48Minor")
    ) {
      return yield* unsupported();
    }
    const outputTax = minor(boxes.box10.exactMinor);
    const deductibleInputTax = minor(boxes.box48.exactMinor);
    const net = minor(boxes.box49?.exactMinor ?? "0");
    if (outputTax < 0n || deductibleInputTax < 0n || net !== outputTax - deductibleInputTax) {
      return yield* unsupported();
    }
    const currentOutput = relevant
      .filter((item) => item.input.treatment === "domestic_sale")
      .reduce((total, item) => total + minor(item.input.vatMinor), 0n);
    const currentInput = relevant
      .filter((item) => item.input.treatment === "domestic_purchase")
      .reduce((total, item) => total + minor(item.input.vatMinor), 0n);
    if (currentOutput !== outputTax || currentInput !== deductibleInputTax) {
      return yield* failure("StaleDependency");
    }
    return {
      outputTax,
      deductibleInputTax,
      net,
      amounts: {
        outputTaxMinor: outputTax.toString(),
        deductibleInputTaxMinor: deductibleInputTax.toString(),
        accountingNetMinor: net.toString(),
        reportedNetKrona: boxes.box49?.reportedKrona ?? "0",
        reportedResidualMinor: boxes.box49?.residualMinor ?? "0",
        assessedMinor: null,
      },
    };
  });
}

function buildPostingLines(
  transaction: Transaction,
  obligationId: string,
  settlementAccountId: string,
  contributions: ReadonlyArray<Contribution>,
  net: bigint,
) {
  return Effect.gen(function* () {
    const lines: Array<JsonObject> = [];
    const ordered = [...contributions].sort((left, right) => {
      if (left.voucherId !== right.voucherId) return left.voucherId < right.voucherId ? -1 : 1;
      return left.lineId === right.lineId ? 0 : left.lineId < right.lineId ? -1 : 1;
    });
    for (const contribution of ordered) {
      const balance = minor(contribution.balanceMinor);
      if (balance === 0n) continue;
      const lineId = `vatline_${yield* shortDigest(transaction, {
        obligationId,
        kind: "reverse",
        factId: contribution.factId,
        voucherId: contribution.voucherId,
        lineId: contribution.lineId,
      })}`;
      lines.push({
        lineId,
        accountId: contribution.accountId,
        debitMinor: balance < 0n ? (-balance).toString() : "0",
        creditMinor: balance > 0n ? balance.toString() : "0",
        description: `Reverse ${contribution.role} VAT control`,
      });
    }
    if (net !== 0n) {
      const lineId = `vatline_${yield* shortDigest(transaction, { obligationId, kind: "settlement" })}`;
      lines.push({
        lineId,
        accountId: settlementAccountId,
        debitMinor: net < 0n ? (-net).toString() : "0",
        creditMinor: net > 0n ? net.toString() : "0",
        description: "VAT settlement control",
      });
    }
    if (lines.length > postingLineBound) return yield* unsupported();
    return lines;
  });
}

function readReclassificationBook(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const book = (yield* VatDb.readControlBook(transaction, scope.bookId))[0];
    if (book === undefined) return yield* failure("Forbidden");
    if (
      book.profile !== "synthetic-core-v1" ||
      book.authority !== "native" ||
      book.currency !== "SEK" ||
      book.currencyScale !== 2
    ) {
      return yield* unsupported();
    }
    return book;
  });
}

export function readReclassificationBasis(
  transaction: Transaction,
  scope: Scope,
  input: ReclassificationInput,
  create: boolean,
) {
  return Effect.gen(function* () {
    if (!isCalendarDate(input.postingDate)) return yield* failure("InvalidJournal");
    const book = yield* readReclassificationBook(transaction, scope);
    const draft = yield* readSelectedDraft(transaction, scope, input);
    const reviewEvidence = yield* Db.readEvidence(transaction, scope.bookId, input.reviewEvidenceId);
    const reviewSha = reviewEvidence[0]?.sha256;
    if (reviewSha === undefined) return yield* failure("MissingEvidence");
    const period = (yield* Db.readPeriod(transaction, scope.bookId, input.accountingPeriodId))[0];
    if (period === undefined) return yield* failure("NotFound");
    const fiscalYear = (yield* Db.readFiscalYear(transaction, scope.bookId, period.fiscalYearId))[0];
    if (fiscalYear === undefined) return yield* failure("NotFound");
    if (
      period.locked ||
      input.postingDate < period.startsOn ||
      input.postingDate > period.endsOn ||
      period.startsOn < fiscalYear.startsOn ||
      period.endsOn > fiscalYear.endsOn
    ) {
      return yield* failure("PeriodLocked");
    }
    const control = yield* readControlAccounts(transaction, scope, input, create);
    const obligation = yield* readObligation(transaction, scope, draft, create);
    if (
      (yield* VatDb.readEffectByObligation(transaction, scope.bookId, obligation.id))[0] !== undefined
    ) {
      return yield* failure("AlreadyPosted");
    }
    yield* requireCompleteLineage(draft);
    const { relevant, current, startsOn, endsOn } = yield* readRelevantFacts(
      transaction,
      scope,
      draft,
      input,
    );
    const { contributions, sourceStates, latestSourceDate } = yield* readContributions(
      transaction,
      scope,
      relevant,
      startsOn,
      endsOn,
      book.committedSequence,
    );
    if (latestSourceDate !== "" && input.postingDate < latestSourceDate) {
      return yield* failure("StaleDependency");
    }
    const selected = new Set(relevant.map((item) => item.factId));
    if (
      current.some(
        (observation) =>
          withinInterval(observation.fact.input.taxPointOn, startsOn, endsOn) &&
          !selected.has(observation.fact.factId),
      )
    ) {
      return yield* failure("StaleDependency");
    }
    if (contributions.length > contributionBound) return yield* unsupported();
    const totals = yield* readBoxTotals(draft, relevant);
    if (
      relevant.length === 0 &&
      (totals.outputTax !== 0n || totals.deductibleInputTax !== 0n || totals.net !== 0n) &&
      contributions.length === 0
    ) {
      return yield* failure("InvalidJournal");
    }
    if (relevant.length === 0 && contributions.length !== 0) return yield* failure("InvalidJournal");
    const roleLedger = yield* requireCompleteRoleLedger(
      transaction,
      scope,
      input,
      contributions,
      startsOn,
      endsOn,
      book.committedSequence,
    );
    const postingLines = yield* buildPostingLines(
      transaction,
      obligation.id,
      input.settlementAccountId,
      contributions,
      totals.net,
    );
    const currentRelevant = relevant.map((item) => item.observation);
    const dependencyDigest = yield* digestValue(transaction, {
      version: "vat_control_reclassification_dependency_v1",
      book: {
        profile: book.profile,
        profileVersion: book.profileVersion,
        authority: book.authority,
        writerEpoch: book.writerEpoch,
        currency: book.currency,
        currencyScale: book.currencyScale,
      },
      draft: {
        id: draft.id,
        digest: draft.digest,
        basisDigest: draft.basis.digest,
        engine: draft.calculation.engine,
        input: draft.input,
        calculation: draft.calculation,
      },
      profile: control.profile,
      accountRoles: control.accountRoles,
      obligation,
      period: { id: period.id, version: period.version.toString() },
      fiscalYear: { id: fiscalYear.id, startsOn: fiscalYear.startsOn, endsOn: fiscalYear.endsOn },
      roleEvidenceSha256: control.profile.evidenceSha256,
      reviewEvidenceSha256: reviewSha,
      currentFacts: currentRelevant,
      sourceStates,
      roleLedger,
      amounts: totals.amounts,
      contributions,
    });
    return yield* decode(BasisSchema, {
      profile: control.profile,
      obligation,
      draft: {
        id: draft.id,
        digest: draft.digest,
        basisDigest: draft.basis.digest,
        engine: draft.calculation.engine,
        startsOn: draft.input.startsOn,
        endsOn: draft.input.endsOn,
      },
      amounts: totals.amounts,
      accountRoles: control.accountRoles,
      contributions,
      period: { id: period.id, version: period.version.toString() },
      roleEvidenceSha256: control.profile.evidenceSha256,
      reviewEvidenceSha256: reviewSha,
      postingLines,
      currentFactDigest: yield* digestValue(transaction, currentRelevant),
      dependencyDigest,
      coverage: "not_established",
      legalProfileActive: false,
      taxAccountMatched: false,
    });
  });
}

function sealPlan(
  transaction: Transaction,
  scope: Scope,
  changeSetId: string,
  dependencies: ReadonlyArray<typeof Accounting.Dependency.Type>,
  actions: ReadonlyArray<Action>,
) {
  return Effect.gen(function* () {
    const withoutDigest = {
      schemaVersion: "1" as const,
      canonicalization: "openerp-c14n-v1" as const,
      id: changeSetId,
      version: 1 as const,
      scope,
      createdAt: yield* isoNow(transaction),
      dependencies,
      groups: [{ id: newId("group"), dependsOnGroupIds: [], actions }],
    };
    const planDigest = yield* digestValue(transaction, withoutDigest);
    return yield* decode(PlanSchema, { ...withoutDigest, planDigest });
  });
}

function buildDependencies(
  book: { readonly id: string; readonly profileVersion: string; readonly writerEpoch: string },
  period: { readonly id: string; readonly version: bigint },
  accounts: ReadonlyArray<{ readonly id: string; readonly version: bigint }>,
) {
  return [
    {
      kind: "profile" as const,
      resourceId: book.id,
      version: book.profileVersion,
      reason: "Book currency and supported native synthetic profile",
    },
    {
      kind: "writer_epoch" as const,
      resourceId: book.id,
      version: book.writerEpoch,
      reason: "Single authoritative writer",
    },
    {
      kind: "period" as const,
      resourceId: period.id,
      version: period.version.toString(),
      reason: "VAT reclassification posting period",
    },
    ...accounts.map((account) => ({
      kind: "account" as const,
      resourceId: account.id,
      version: account.version.toString(),
      reason: "Exact VAT control account configuration",
    })),
  ];
}

export const prepareReclassification = Effect.fn("vat.prepareReclassification")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: ReclassificationInput },
) {
  return yield* withVatBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "prepare_vat_control_reclassification",
          principal.actorId,
          payload,
          ReviewSchema,
        );
        if (request.previous) return request.previous;
        yield* requireReclassificationAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const basis = yield* readReclassificationBasis(
          transaction,
          command.scope,
          command.input,
          true,
        );
        const reviews = yield* VatDb.countRows(
          transaction,
          "vat_control_reclassification_reviews",
          command.scope.bookId,
        );
        if ((reviews[0]?.total ?? 0) >= reviewBound) return yield* unsupported();
        const ordinal = (
          yield* VatDb.countReviewsForObligation(
            transaction,
            command.scope.bookId,
            basis.obligation.id,
          )
        )[0]?.ordinal;
        if (ordinal === undefined || ordinal > obligationReviewBound) return yield* unsupported();
        const book = (yield* VatDb.readControlBook(transaction, command.scope.bookId))[0];
        const period = (
          yield* Db.readPeriod(transaction, command.scope.bookId, command.input.accountingPeriodId)
        )[0];
        if (book === undefined || period === undefined) return yield* failure("NotFound");
        const accounts = yield* Db.readAccounts(transaction, command.scope.bookId, [
          command.input.outputAccountId,
          command.input.inputAccountId,
          command.input.settlementAccountId,
        ]);
        const eventKey = `vat_control_reclassification_${basis.obligation.id}`;
        const existingEvents = yield* Db.readEvent(
          transaction,
          command.scope.bookId,
          command.input.roleEvidenceId,
          eventKey,
        );
        const eventId = existingEvents[0]?.id ?? newId("event");
        if (existingEvents.length === 0) {
          yield* Db.insertEvent(
            transaction,
            command.scope.bookId,
            eventId,
            command.input.roleEvidenceId,
            eventKey,
          );
        }
        const reviewId = newId("vatreview");
        let changeSetId: string | null = null;
        let plan: typeof Accounting.ChangeSet.Type | null = null;
        if (basis.postingLines.length > 0) {
          changeSetId = newId("change");
          const action = yield* decode(ActionSchema, {
            kind: "post_voucher",
            correctsVoucherId: null,
            eventId,
            postingPurpose: "vat_control_reclassification_v1",
            occurrenceKey: eventKey,
            fiscalYearId: period.fiscalYearId,
            accountingPeriodId: period.id,
            postingDate: command.input.postingDate,
            series: command.input.series,
            currency: book.currency,
            description: `VAT control reclassification ${basis.obligation.id}`,
            rationale: command.input.rationale,
            taxAssessment: "not_applicable",
            vatReclassification: {
              reviewId,
              obligationId: basis.obligation.id,
              draftId: command.input.draftId,
            },
            lines: basis.postingLines.map((line) => ({
              lineId: String(line.lineId),
              accountId: String(line.accountId),
              debitMinor: String(line.debitMinor),
              creditMinor: String(line.creditMinor),
              description: String(line.description),
            })),
            evidenceRefs: [
              {
                evidenceId: command.input.roleEvidenceId,
                sha256: basis.roleEvidenceSha256,
                locator: "vat-control-account-roles",
              },
              {
                evidenceId: command.input.reviewEvidenceId,
                sha256: basis.reviewEvidenceSha256,
                locator: "vat-control-reclassification-review",
              },
            ],
          });
          plan = yield* sealPlan(
            transaction,
            command.scope,
            changeSetId,
            buildDependencies(book, period, accounts),
            [action],
          );
        }
        const body = yield* digestBody(transaction, {
          id: reviewId,
          scope: command.scope,
          version: 1,
          ordinal,
          state: "prepared",
          input: command.input,
          basis,
          postingPlan: plan,
          requiresOperatorApproval: true,
          assessmentEffect: "none",
          cashTransferEffect: "none",
          filingReady: false,
          externalState: "not_submitted",
          createdAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "prepare_vat_control_reclassification",
            actorId: principal.actorId,
          },
        });
        const review = yield* decode(ReviewSchema, body);
        yield* VatDb.insertReview(transaction, {
          bookId: command.scope.bookId,
          id: reviewId,
          obligationId: basis.obligation.id,
          profileId: basis.profile.id,
          draftId: command.input.draftId,
          actorId: principal.actorId,
          ordinal,
          changeSetId,
          body,
        });
        if (plan !== null && changeSetId !== null) {
          yield* Db.insertPlan(transaction, {
            bookId: command.scope.bookId,
            id: changeSetId,
            plan: yield* toJsonObject(plan),
            digest: plan.planDigest,
            createdBy: principal.actorId,
          });
        }
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "prepare_vat_control_reclassification",
          principal.actorId,
          review,
        );
        return review;
      }),
    "update",
  );
});

function requireReclassificationAction(
  transaction: Transaction,
  scope: Scope,
  review: typeof ReviewSchema.Type,
  action: Action,
  book: { readonly currency: string; readonly profile: string },
) {
  return Effect.gen(function* () {
    if (action.postingPurpose !== "vat_control_reclassification_v1") {
      return yield* failure("InvalidJournal");
    }
    if (!bindsRetainedReview(review, action, book)) return yield* failure("InvalidJournal");
    const period = yield* requireOpenPeriod(transaction, scope, action);
    const accountIds = action.lines.map((line) => line.accountId);
    const accounts = yield* Db.readAccounts(transaction, scope.bookId, accountIds);
    if (accounts.length !== new Set(accountIds).size) return yield* failure("InvalidJournal");
    if (accounts.some((account) => !account.active)) return yield* failure("InvalidJournal");
    if (!balancesExactly(action.lines)) return yield* failure("InvalidJournal");
    for (const reference of action.evidenceRefs) {
      const evidence = yield* Db.readEvidence(transaction, scope.bookId, reference.evidenceId);
      if (evidence[0]?.sha256 !== reference.sha256) return yield* failure("MissingEvidence");
    }
    if ((yield* Db.readEventById(transaction, scope.bookId, action.eventId)).length !== 1) {
      return yield* failure("InvalidJournal");
    }
    if (period.locked) return yield* failure("PeriodLocked");
  });
}

function bindsRetainedReview(
  review: typeof ReviewSchema.Type,
  action: Action,
  book: { readonly currency: string; readonly profile: string },
) {
  const meta = action.vatReclassification;
  if (meta === null || meta === undefined) return false;
  if (action.correctsVoucherId !== null) return false;
  if (action.occurrenceKey !== `vat_control_reclassification_${review.basis.obligation.id}`) {
    return false;
  }
  if (meta.reviewId !== review.id) return false;
  if (meta.obligationId !== review.basis.obligation.id) return false;
  if (meta.draftId !== review.input.draftId) return false;
  if (action.currency !== book.currency) return false;
  if (book.profile !== "synthetic-core-v1") return false;
  if (action.lines.length < 2 || action.lines.length > 500) return false;
  if (action.evidenceRefs.length < 1) return false;
  return isCalendarDate(action.postingDate);
}

function requireOpenPeriod(
  transaction: Transaction,
  scope: Scope,
  action: Action,
) {
  return Effect.gen(function* () {
    const period = (yield* Db.readPeriod(transaction, scope.bookId, action.accountingPeriodId))[0];
    if (period === undefined) return yield* failure("InvalidJournal");
    const fiscalYear = (yield* Db.readFiscalYear(transaction, scope.bookId, period.fiscalYearId))[0];
    if (
      fiscalYear === undefined ||
      action.fiscalYearId !== period.fiscalYearId ||
      action.postingDate < period.startsOn ||
      action.postingDate > period.endsOn ||
      action.postingDate < fiscalYear.startsOn ||
      action.postingDate > fiscalYear.endsOn
    ) {
      return yield* failure("InvalidJournal");
    }
    return period;
  });
}

function balancesExactly(
  lines: ReadonlyArray<{ readonly lineId: string; readonly debitMinor: string; readonly creditMinor: string }>,
) {
  let debit = 0n;
  let credit = 0n;
  const lineIds = new Set<string>();
  for (const line of lines) {
    if (lineIds.has(line.lineId)) return false;
    lineIds.add(line.lineId);
    const lineDebit = minor(line.debitMinor);
    const lineCredit = minor(line.creditMinor);
    if (!((lineDebit > 0n && lineCredit === 0n) || (lineCredit > 0n && lineDebit === 0n))) {
      return false;
    }
    debit += lineDebit;
    credit += lineCredit;
  }
  return debit === credit && debit > 0n;
}

function requirePlanCurrent(
  transaction: Transaction,
  scope: Scope,
  review: typeof ReviewSchema.Type,
  changeSetId: string | null,
) {
  return Effect.gen(function* () {
    const plan = review.postingPlan;
    if (plan === null || changeSetId === null) {
      if (plan !== null) return yield* failure("StaleDependency");
      return { plan: null, action: null } as const;
    }
    const sealed = yield* digestValue(transaction, {
      schemaVersion: plan.schemaVersion,
      canonicalization: plan.canonicalization,
      id: plan.id,
      version: plan.version,
      scope: plan.scope,
      createdAt: plan.createdAt,
      dependencies: plan.dependencies,
      groups: plan.groups,
    });
    if (sealed !== plan.planDigest) return yield* failure("StaleDependency");
    const book = (yield* Db.readBook(transaction, scope))[0];
    if (book === undefined) return yield* failure("Forbidden");
    const accounts = yield* Db.readAccounts(
      transaction,
      scope.bookId,
      plan.dependencies.flatMap((dependency) =>
        dependency.kind === "account" ? [dependency.resourceId] : [],
      ),
    );
    const versions = new Map(accounts.map((account) => [account.id, account.version.toString()]));
    for (const dependency of plan.dependencies) {
      let current: string | undefined;
      if (dependency.kind === "profile") current = book.profileVersion.toString();
      if (dependency.kind === "writer_epoch") current = book.writerEpoch.toString();
      if (dependency.kind === "period") {
        const period = (yield* Db.readPeriod(transaction, scope.bookId, dependency.resourceId))[0];
        current = period?.version.toString();
      }
      if (dependency.kind === "account") current = versions.get(dependency.resourceId);
      if (current !== dependency.version) return yield* failure("StaleDependency");
    }
    const action = plan.groups[0]?.actions[0];
    if (plan.groups.length !== 1 || action === undefined) return yield* failure("InvalidJournal");
    yield* requireReclassificationAction(transaction, scope, review, action, book);
    return { plan, action, changeSetId } as const;
  });
}

export const approveReclassification = Effect.fn("vat.approveReclassification")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Vat.ApproveVatControlReclassification.Type;
  },
) {
  return yield* withVatBook(
    token,
    command.scope,
    true,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "approve_vat_control_reclassification",
          principal.actorId,
          payload,
          DomainApprovalSchema,
        );
        if (request.previous) return request.previous;
        yield* requireReclassificationAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const row = (yield* VatDb.readReview(transaction, command.scope.bookId, command.id))[0];
        if (row === undefined) return yield* failure("NotFound");
        const review = yield* decode(ReviewSchema, row.body);
        if (review.digest !== command.input.expectedReviewDigest) {
          return yield* failure("StaleDependency");
        }
        const retained = yield* VatDb.countApprovalsForReview(
          transaction,
          command.scope.bookId,
          review.id,
        );
        if ((retained[0]?.total ?? 0) >= approvalBound) return yield* unsupported();
        const current = yield* readReclassificationBasis(
          transaction,
          command.scope,
          review.input,
          false,
        );
        if (!sameJson(current, review.basis)) return yield* failure("StaleDependency");
        const { plan } = yield* requirePlanCurrent(
          transaction,
          command.scope,
          review,
          row.changeSetId,
        );
        let kernelApproval: typeof Accounting.Approval.Type | null = null;
        if (plan !== null) {
          if (
            (yield* Db.readVoucherByChangeSet(transaction, command.scope.bookId, plan.id)).length > 0
          ) {
            return yield* failure("AlreadyPosted");
          }
          const now = yield* Db.readDatabaseTime(transaction);
          const stored = (
            yield* Db.insertApproval(transaction, {
              bookId: command.scope.bookId,
              id: newId("approval"),
              changeSetId: plan.id,
              digest: plan.planDigest,
              actorId: principal.actorId,
              expiresAt: new Date(Date.parse(now.now) + approvalLifetimeMs).toISOString(),
            })
          )[0];
          if (stored === undefined) return yield* failure("InternalError");
          kernelApproval = yield* decode(KernelApprovalSchema, {
            id: stored.id,
            changeSetId: stored.changeSetId,
            planDigest: stored.digest,
            actorId: stored.actorId,
            expiresAt: stored.expiresAt,
          });
        }
        const createdAt = yield* isoNow(transaction);
        const body = yield* digestBody(transaction, {
          id: newId("vatapproval"),
          scope: command.scope,
          version: 1,
          reviewId: review.id,
          reviewDigest: review.digest,
          actorId: principal.actorId,
          expiresAt: new Date(Date.parse(createdAt) + approvalLifetimeMs).toISOString(),
          kernelApproval,
          createdAt,
          receipt: {
            key: command.idempotencyKey,
            operation: "approve_vat_control_reclassification",
            actorId: principal.actorId,
          },
        });
        const approval = yield* decode(DomainApprovalSchema, body);
        yield* VatDb.insertDomainApproval(transaction, command.scope.bookId, {
          id: approval.id,
          reviewId: review.id,
          actorId: principal.actorId,
          reviewDigest: review.digest,
          kernelApprovalId: kernelApproval?.id ?? null,
          expiresAt: approval.expiresAt,
          body,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "approve_vat_control_reclassification",
          principal.actorId,
          approval,
        );
        return approval;
      }),
    "update",
  );
});

function readCurrentApproval(
  transaction: Transaction,
  scope: Scope,
  approvalId: string,
  review: typeof ReviewSchema.Type,
) {
  return Effect.gen(function* () {
    const row = (yield* VatDb.readApproval(transaction, scope.bookId, approvalId))[0];
    if (row === undefined || row.reviewId !== review.id) return yield* failure("ApprovalRequired");
    if (row.reviewDigest !== review.digest) return yield* failure("ApprovalRequired");
    const now = yield* Db.readDatabaseTime(transaction);
    if (Date.parse(row.expiresAt) <= Date.parse(now.now)) return yield* failure("ApprovalRequired");
    if ((yield* Db.readOperatorMembership(transaction, scope.bookId, row.actorId)).length === 0) {
      return yield* failure("ApprovalRequired");
    }
    if ((yield* Db.readActorAdmission(transaction, row.actorId))[0]?.enabled === false) {
      return yield* failure("ApprovalRequired");
    }
    return row;
  });
}

function commitReclassificationVoucher(
  transaction: Transaction,
  scope: Scope,
  principal: Principal,
  plan: typeof Accounting.ChangeSet.Type,
  action: Action,
  kernelApprovalId: string,
) {
  return Effect.gen(function* () {
    const approval = (yield* Db.readApproval(transaction, scope.bookId, kernelApprovalId, "update"))[0];
    if (
      approval === undefined ||
      approval.changeSetId !== plan.id ||
      approval.digest !== plan.planDigest ||
      approval.consumedAt !== null
    ) {
      return yield* failure("ApprovalRequired");
    }
    if ((yield* Db.readOperatorMembership(transaction, scope.bookId, approval.actorId)).length === 0) {
      return yield* failure("ApprovalRequired");
    }
    if ((yield* Db.readActorAdmission(transaction, approval.actorId))[0]?.enabled === false) {
      return yield* failure("ApprovalRequired");
    }
    if ((yield* Db.readApprovalRevocation(transaction, scope.bookId, approval.id)).length > 0) {
      return yield* failure("ApprovalRequired");
    }
    const now = yield* Db.readDatabaseTime(transaction);
    if (Date.parse(approval.expiresAt) <= Date.parse(now.now)) {
      return yield* failure("ApprovalRequired");
    }
    if ((yield* Db.readVoucherByChangeSet(transaction, scope.bookId, plan.id)).length > 0) {
      return yield* failure("AlreadyPosted");
    }
    const counter = yield* Db.allocateSeriesCounter(
      transaction,
      scope.bookId,
      action.fiscalYearId,
      action.series,
    );
    const sequence = yield* Db.allocateSequence(transaction, scope.bookId);
    const voucherNumber = counter[0]?.lastNumber;
    const sequenceValue = sequence[0]?.sequence;
    if (voucherNumber === undefined || sequenceValue === undefined) {
      return yield* failure("InternalError");
    }
    const voucherId = newId("voucher");
    const voucher = yield* Db.insertVoucher(transaction, {
      bookId: scope.bookId,
      id: voucherId,
      fiscalYearId: action.fiscalYearId,
      periodId: action.accountingPeriodId,
      series: action.series,
      number: voucherNumber,
      sequence: sequenceValue,
      postingDate: action.postingDate,
      eventId: action.eventId,
      postingPurpose: action.postingPurpose,
      occurrenceKey: action.occurrenceKey,
      correctsVoucherId: action.correctsVoucherId ?? null,
      changeSetId: plan.id,
      action: yield* toJsonObject(action),
      expectedLineCount: action.lines.length,
    });
    const recordedAt = voucher[0]?.recordedAt;
    if (recordedAt === undefined) return yield* failure("InternalError");
    yield* Db.insertJournalLines(
      transaction,
      action.lines.map((line, index) => ({
        bookId: scope.bookId,
        voucherId,
        id: line.lineId,
        ordinal: index + 1,
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description,
      })),
    );
    const receipt = yield* decode(ReceiptSchema, {
      id: newId("receipt"),
      changeSetId: plan.id,
      voucherId,
      planDigest: plan.planDigest,
      sequence: sequenceValue.toString(),
      voucherNumber: voucherNumber.toString(),
      committedAt: recordedAt,
    });
    const groupReceipt = yield* decode(GroupReceiptSchema, {
      id: newId("group_receipt"),
      changeSetId: plan.id,
      groupId: plan.groups[0]?.id ?? newId("group"),
      planDigest: plan.planDigest,
      executionReceipts: [receipt],
      committedAt: recordedAt,
    });
    yield* Db.insertExecutionReceipt(transaction, {
      bookId: scope.bookId,
      id: receipt.id,
      changeSetId: plan.id,
      voucherId,
      approvalId: approval.id,
      body: receipt,
    });
    yield* Db.insertGroupReceipt(transaction, {
      bookId: scope.bookId,
      id: groupReceipt.id,
      changeSetId: plan.id,
      groupId: groupReceipt.groupId,
      planDigest: plan.planDigest,
      body: groupReceipt,
      committedAt: recordedAt,
    });
    yield* Db.insertApprovalConsumption(transaction, {
      bookId: scope.bookId,
      approvalId: approval.id,
      changeSetId: plan.id,
      groupId: groupReceipt.groupId,
      planDigest: plan.planDigest,
      receiptId: groupReceipt.id,
      approverId: approval.actorId,
      consumedById: principal.actorId,
      consumedAt: recordedAt,
    });
    const consumed = yield* Db.consumeApproval(
      transaction,
      scope.bookId,
      approval.id,
      recordedAt,
    );
    if (consumed.length !== 1) return yield* failure("InternalError");
    yield* Db.insertOutbox(transaction, {
      bookId: scope.bookId,
      id: newId("outbox"),
      receiptId: receipt.id,
      kind: "voucher.posted.v1",
      payload: receipt,
    });
    return receipt;
  });
}

export const executeReclassification = Effect.fn("vat.executeReclassification")(function* (
  token: string,
  command: {
    scope: Scope;
    id: string;
    idempotencyKey: string;
    input: typeof Vat.ExecuteVatControlReclassification.Type;
  },
) {
  return yield* withVatBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject({ id: command.id, input: command.input });
        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "execute_vat_control_reclassification",
          principal.actorId,
          payload,
          EffectSchema,
        );
        if (request.previous) return request.previous;
        yield* requireReclassificationAccess(transaction, true);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const row = (yield* VatDb.readReview(transaction, command.scope.bookId, command.id))[0];
        if (row === undefined) return yield* failure("NotFound");
        const review = yield* decode(ReviewSchema, row.body);
        if (review.digest !== command.input.expectedReviewDigest) {
          return yield* failure("StaleDependency");
        }
        if (
          (yield* VatDb.readEffectByObligation(transaction, command.scope.bookId, row.obligationId))[0] !==
          undefined
        ) {
          return yield* failure("AlreadyPosted");
        }
        const approval = yield* readCurrentApproval(
          transaction,
          command.scope,
          command.input.approvalId,
          review,
        );
        const current = yield* readReclassificationBasis(
          transaction,
          command.scope,
          review.input,
          false,
        );
        if (!sameJson(current, review.basis)) return yield* failure("StaleDependency");
        const inventory = yield* VatDb.countRows(
          transaction,
          "vat_control_reclassification_contributions",
          command.scope.bookId,
        );
        if (
          (inventory[0]?.total ?? 0) + review.basis.contributions.length >
          contributionInventoryBound
        ) {
          return yield* unsupported();
        }
        const { plan, action, changeSetId } = yield* requirePlanCurrent(
          transaction,
          command.scope,
          review,
          row.changeSetId,
        );
        const effectId = newId("vateffect");
        const createdAt = yield* isoNow(transaction);
        let postingReceipt: typeof Accounting.ExecutionReceipt.Type | null = null;
        if (plan !== null && action !== null) {
          if (approval.kernelApprovalId === null) return yield* failure("ApprovalRequired");
          postingReceipt = yield* commitReclassificationVoucher(
            transaction,
            command.scope,
            principal,
            plan,
            action,
            approval.kernelApprovalId,
          );
        }
        const body = yield* digestBody(transaction, {
          id: effectId,
          scope: command.scope,
          version: 1,
          obligationId: review.basis.obligation.id,
          draftId: review.input.draftId,
          reviewId: review.id,
          reviewDigest: review.digest,
          approvalId: approval.id,
          outcome: postingReceipt === null ? "no_effect" : "posted",
          amounts: review.basis.amounts,
          changeSetId: postingReceipt === null ? null : (changeSetId ?? null),
          voucherId: postingReceipt === null ? null : postingReceipt.voucherId,
          postingReceipt,
          postingDate: review.input.postingDate,
          assessmentEffect: "none",
          cashTransferEffect: "none",
          filingReady: false,
          externalState: "not_submitted",
          createdAt,
          receipt: {
            key: command.idempotencyKey,
            operation: "execute_vat_control_reclassification",
            actorId: principal.actorId,
          },
        });
        const effect = yield* decode(EffectSchema, body);
        yield* VatDb.insertEffect(transaction, {
          bookId: command.scope.bookId,
          id: effectId,
          obligationId: effect.obligationId,
          reviewId: effect.reviewId,
          approvalId: effect.approvalId,
          draftId: effect.draftId,
          outcome: effect.outcome,
          changeSetId: effect.changeSetId,
          voucherId: effect.voucherId,
          postingReceiptId: postingReceipt?.id ?? null,
          postingDate: review.input.postingDate,
          body,
        });
        if (postingReceipt !== null) {
          const contributions = yield* Effect.forEach(review.basis.contributions, (contribution) =>
            toJsonObject(contribution),
          );
          yield* VatDb.insertContributions(
            transaction,
            contributions.map((contribution, index) => ({
              bookId: command.scope.bookId,
              id: newId("vatcontribution"),
              effectId,
              ordinal: index + 1,
              factId: review.basis.contributions[index]?.factId ?? "",
              factRevisionId: review.basis.contributions[index]?.factRevisionId ?? "",
              voucherId: review.basis.contributions[index]?.voucherId ?? "",
              lineId: review.basis.contributions[index]?.lineId ?? "",
              body: contribution,
            })),
          );
        }
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "execute_vat_control_reclassification",
          principal.actorId,
          effect,
        );
        return effect;
      }),
    "update",
  );
});

export const getReclassification = Effect.fn("vat.getReclassification")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireReclassificationAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const row = (yield* VatDb.readReview(transaction, command.scope.bookId, command.id))[0];
      if (row === undefined) return yield* failure("NotFound");
      const review = yield* decode(ReviewSchema, row.body);
      const approvals = yield* VatDb.readApprovals(transaction, command.scope.bookId, review.id);
      const effect = (yield* VatDb.readEffectByReview(transaction, command.scope.bookId, review.id))[0];
      let liveBasisCheckedAt: string | null = null;
      if (effect === undefined) {
        const checked = yield* readReclassificationBasis(
          transaction,
          command.scope,
          review.input,
          false,
        ).pipe(
          Effect.map(() => true),
          Effect.orElseSucceed(() => false),
        );
        if (checked) liveBasisCheckedAt = yield* isoNow(transaction);
      }
      return yield* decode(ViewSchema, {
        review,
        approvals: yield* Effect.forEach(approvals, (approval) =>
          decode(DomainApprovalSchema, approval.body),
        ),
        reclassification: effect === undefined ? null : yield* decode(EffectSchema, effect.body),
        liveBasisCheckedAt,
      });
    }),
  );
});

export const listReclassifications = Effect.fn("vat.listReclassifications")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withVatBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireReclassificationAccess(transaction, false);
      yield* Db.lockBookForShare(transaction, command.scope);
      const count = yield* VatDb.countReviewItems(transaction, command.scope.bookId);
      if ((count[0]?.total ?? 0) > reviewBound) return yield* unsupported();
      const rows = yield* VatDb.listReviewItems(transaction, command.scope.bookId);
      return yield* decode(ListSchema, {
        scope: command.scope,
        items: rows.map((row) => row.item),
      });
    }),
  );
});
