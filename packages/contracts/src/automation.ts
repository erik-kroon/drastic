import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors } from "./accounting-errors";
import { CommandReceipt, RowOrdinal } from "./reconciliation";

export const ProposeRecurringRule = Schema.Struct({
  kind: Schema.Literal("synthetic_recurring_preparation_v1"),
  name: Accounting.Description,
  sourceBankAccountId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  accountId: Accounting.Identifier,
  description: Accounting.Description,
  sign: Schema.Literals(["positive", "negative"]),
  counterpartAccountId: Accounting.Identifier,
  series: Schema.String.check(Schema.isPattern(/^[A-Z0-9]{1,16}$/)),
  taxAssessment: Schema.Literal("not_applicable"),
});
export const RecurringRule = Schema.Struct({
  id: Accounting.Identifier,
  version: Schema.Literal(1),
  scope: Accounting.Scope,
  input: ProposeRecurringRule,
  dependencies: Schema.Array(Accounting.Dependency),
  digest: Accounting.Digest,
  createdAt: Schema.String,
  proposedBy: Accounting.Identifier,
  receipt: CommandReceipt,
});
export const SimulationInterval = Schema.Struct({
  startsOn: Accounting.AccountingDate,
  endsOn: Accounting.AccountingDate,
});
export const SimulateRecurringRule = Schema.Struct({
  ...SimulationInterval.fields,
  ruleId: Accounting.Identifier,
});
export const RuleObservation = Schema.Struct({
  statementId: Accounting.Identifier,
  rowOrdinal: RowOrdinal,
  evidenceId: Accounting.Identifier,
  date: Accounting.AccountingDate,
  description: Accounting.Description,
  amountMinor: Accounting.SignedMinorUnits,
  accountingPeriodId: Schema.NullOr(Accounting.Identifier),
  periodVersion: Schema.NullOr(Accounting.MinorUnits),
});
export const SimulationSelection = Schema.Struct({
  ...SimulationInterval.fields,
  sourceRevision: Accounting.MinorUnits,
  sequence: Accounting.MinorUnits,
  rows: Schema.Array(RuleObservation),
  matchingCount: Schema.Int,
  totalMinor: Accounting.SignedMinorUnits,
  unmatchedCount: Schema.Int,
  alreadyMatchedCount: Schema.Int,
  overlappingRuleIds: Schema.Array(Accounting.Identifier),
  blockers: Schema.Array(Schema.String),
});
export const RuleSimulation = Schema.Struct({
  ...SimulationSelection.fields,
  id: Accounting.Identifier,
  ruleId: Accounting.Identifier,
  ruleDigest: Accounting.Digest,
  digest: Accounting.Digest,
  createdAt: Schema.String,
  receipt: CommandReceipt,
});
export const ActivateRecurringRule = Schema.Struct({
  ruleId: Accounting.Identifier,
  ruleDigest: Accounting.Digest,
  simulationId: Accounting.Identifier,
  simulationDigest: Accounting.Digest,
});
export const RuleActivation = Schema.Struct({
  id: Accounting.Identifier,
  ...ActivateRecurringRule.fields,
  actorId: Accounting.Identifier,
  activatedAt: Schema.String,
  authority: Schema.Literal("prepare_only"),
  receipt: CommandReceipt,
});
export const DeactivateRecurringRule = Schema.Struct({
  activationId: Accounting.Identifier,
  reason: Accounting.Description,
});
export const RuleDeactivation = Schema.Struct({
  ...DeactivateRecurringRule.fields,
  actorId: Accounting.Identifier,
  deactivatedAt: Schema.String,
  receipt: CommandReceipt,
});
export const RecurringRuleView = Schema.Struct({
  rule: RecurringRule,
  activeActivation: Schema.NullOr(RuleActivation),
  dependenciesCurrent: Schema.Boolean,
});
export const CreatePreparationRun = Schema.Struct({
  ...SimulationInterval.fields,
  activationId: Accounting.Identifier,
});
export const AdvancePreparationRun = Schema.Struct({
  action: Schema.Literals(["continue", "cancel", "resume"]),
  maxItems: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
});
export const PreparationResult = Schema.Struct({
  statementId: Accounting.Identifier,
  rowOrdinal: RowOrdinal,
  state: Schema.Literals(["prepared", "recovered", "already_posted", "skipped_matched"]),
  changeSetId: Schema.NullOr(Accounting.Identifier),
  planDigest: Schema.NullOr(Accounting.Digest),
  voucherId: Schema.NullOr(Accounting.Identifier),
});
export const RunAuditEntry = Schema.Struct({
  index: Schema.Int,
  action: Schema.String,
  state: Schema.Literals(["ready", "blocked", "cancelled", "completed"]),
  cursor: Schema.Int,
  blocker: Schema.NullOr(Schema.Struct({ code: Accounting.FailureCode, message: Schema.String })),
  actorId: Accounting.Identifier,
  recordedAt: Schema.String,
  receipt: CommandReceipt,
});
export const PreparationRun = Schema.Struct({
  id: Accounting.Identifier,
  scope: Accounting.Scope,
  ruleId: Accounting.Identifier,
  ruleDigest: Accounting.Digest,
  activationId: Accounting.Identifier,
  selection: SimulationSelection,
  state: RunAuditEntry.fields.state,
  cursor: Schema.Int,
  total: Schema.Int,
  results: Schema.Array(PreparationResult),
  blocker: RunAuditEntry.fields.blocker,
  audit: Schema.Array(RunAuditEntry),
  requiresPostingApproval: Schema.Literal(true),
});

const path = "/v1/entities/:entityId/books/:bookId";
const scoped = { params: Accounting.Scope, error: accountingErrors };
const mutation = { ...scoped, headers: Accounting.IdempotencyHeaders };
const identified = { params: Accounting.ChangePath, error: accountingErrors };
export const AutomationApi = HttpApiGroup.make("automation").add(
  HttpApiEndpoint.post("proposeRecurringRule", `${path}/recurring-rules`, {
    ...mutation,
    payload: ProposeRecurringRule.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RecurringRule,
  }),
  HttpApiEndpoint.get("getRecurringRule", `${path}/recurring-rules/:id`, {
    ...identified,
    success: RecurringRuleView,
  }),
  HttpApiEndpoint.post("simulateRecurringRule", `${path}/recurring-rule-simulations`, {
    ...mutation,
    payload: SimulateRecurringRule.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RuleSimulation,
  }),
  HttpApiEndpoint.get("getRecurringSimulation", `${path}/recurring-rule-simulations/:id`, {
    ...identified,
    success: RuleSimulation,
  }),
  HttpApiEndpoint.post("activateRecurringRule", `${path}/recurring-rule-activations`, {
    ...mutation,
    payload: ActivateRecurringRule.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RuleActivation,
  }),
  HttpApiEndpoint.post("deactivateRecurringRule", `${path}/recurring-rule-deactivations`, {
    ...mutation,
    payload: DeactivateRecurringRule.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: RuleDeactivation,
  }),
  HttpApiEndpoint.post("createPreparationRun", `${path}/preparation-runs`, {
    ...mutation,
    payload: CreatePreparationRun.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PreparationRun,
  }),
  HttpApiEndpoint.get("getPreparationRun", `${path}/preparation-runs/:id`, {
    ...identified,
    success: PreparationRun,
  }),
  HttpApiEndpoint.post("advancePreparationRun", `${path}/preparation-runs/:id/advance`, {
    ...identified,
    headers: Accounting.IdempotencyHeaders,
    payload: AdvancePreparationRun.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PreparationRun,
  }),
);
