import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";

export const RehearsalFailureCode = Schema.Literals([
  "BackupIncomplete",
  "MigrationDrift",
  "ControlDifference",
  "DanglingReference",
  "UnhandledFamily",
  "UnknownApplicability",
  "MissingHandoff",
  "StaleEvidence",
  "FenceViolation",
]);

export type RehearsalFailureCode = typeof RehearsalFailureCode.Type;

export const RehearsalFailure = Schema.Struct({
  code: RehearsalFailureCode,
  message: Description,
});

export type RehearsalFailure = typeof RehearsalFailure.Type;

export type Checked<A> = Result.Result<A, RehearsalFailure>;

function fail(code: RehearsalFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const OwnerHandoff = Schema.Struct({
  packet: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  sourceDigest: Digest,
  observedAssertions: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  ),
  evidenceRefs: Schema.Array(Identifier),
});

export type OwnerHandoff = typeof OwnerHandoff.Type;

export const AcceptanceRow = Schema.Struct({
  scope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  requiredBehavior: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  applicability: Schema.Literals(["yes", "no_with_evidence", "unknown"]),
  implementedRevision: Schema.NullOr(Identifier),
  observedEvidence: Schema.NullOr(Identifier),
  blockers: Schema.Array(Identifier),
  responsibleOwner: Identifier,
});

export type AcceptanceRow = typeof AcceptanceRow.Type;

export const AcceptanceLedger = Schema.Struct({
  checkpointId: Identifier,
  repositoryCommit: Identifier,
  sourceDigest: Digest,
  rows: Schema.Array(AcceptanceRow),
  waitingHandoffs: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32))),
});

export type AcceptanceLedger = typeof AcceptanceLedger.Type;

export const BuildLedgerInput = Schema.Struct({
  checkpointId: Identifier,
  repositoryCommit: Identifier,
  sourceDigest: Digest,
  rows: Schema.Array(AcceptanceRow),
  requiredPackets: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32))),
  handoffs: Schema.Array(OwnerHandoff),
});

export type BuildLedgerInput = typeof BuildLedgerInput.Type;

export function buildAcceptanceLedger(input: BuildLedgerInput): Checked<AcceptanceLedger> {
  if (new Set(input.handoffs.map((handoff) => handoff.packet)).size !== input.handoffs.length) {
    return fail("StaleEvidence", "Duplicate owner handoffs cannot establish one checkpoint.");
  }

  for (const handoff of input.handoffs) {
    if (handoff.sourceDigest !== input.sourceDigest) {
      return fail("StaleEvidence", "Owner evidence belongs to a different captured source digest.");
    }
  }

  const provided = new Map(input.handoffs.map((handoff) => [handoff.packet, handoff]));
  const waiting: Array<string> = [];

  for (const packet of input.requiredPackets) {
    if (!provided.has(packet)) waiting.push(packet);
  }

  for (const row of input.rows) {
    if (row.applicability === "unknown") {
      return fail("UnknownApplicability", "Unknown applicability blocks the acceptance row.");
    }
  }

  return Result.succeed({
    checkpointId: input.checkpointId,
    repositoryCommit: input.repositoryCommit,
    sourceDigest: input.sourceDigest,
    rows: [...input.rows],
    waitingHandoffs: waiting,
  });
}

export const BackupMember = Schema.Struct({
  family: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  contentHash: Digest,
  byteSize: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,18})$/)),
  verified: Schema.Boolean,
  references: Schema.Array(Digest),
});

export type BackupMember = typeof BackupMember.Type;

export const VerifyBackupInput = Schema.Struct({
  members: Schema.Array(BackupMember).check(Schema.isMinLength(1)),
  familyHandlers: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  sameSnapshot: Schema.Boolean,
});

export type VerifyBackupInput = typeof VerifyBackupInput.Type;

export const BackupCertificate = Schema.Struct({
  manifestDigest: Digest,
  memberCount: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,18})$/)),
});

export type BackupCertificate = typeof BackupCertificate.Type;

export const VerifyBackupInputWithDigest = Schema.Struct({
  ...VerifyBackupInput.fields,
  manifestDigest: Digest,
});

export type VerifyBackupInputWithDigest = typeof VerifyBackupInputWithDigest.Type;

export function verifyBackupManifest(
  input: VerifyBackupInputWithDigest,
): Checked<BackupCertificate> {
  if (!input.sameSnapshot) {
    return fail(
      "BackupIncomplete",
      "Members captured across snapshots are not one consistent backup.",
    );
  }

  const known = new Set(input.members.map((member) => member.contentHash));
  const handlers = new Set(input.familyHandlers);

  for (const member of input.members) {
    if (!member.verified) {
      return fail("BackupIncomplete", "An unverified member leaves the backup incomplete.");
    }

    for (const reference of member.references) {
      if (!known.has(reference)) {
        return fail("DanglingReference", "A required reference has no retained member.");
      }
    }

    if (!handlers.has(member.family)) {
      return fail("UnhandledFamily", "An inventory family has no backup handler.");
    }
  }

  return Result.succeed({
    manifestDigest: input.manifestDigest,
    memberCount: input.members.length.toString(),
  });
}

const RestoreObservation = Schema.Union([Schema.Boolean, Schema.Literal("unavailable")]);

export const RestoreComparison = Schema.Struct({
  schemaHashesMatch: RestoreObservation,
  migrationHashesMatch: RestoreObservation,
  entityCountsMatch: RestoreObservation,
  ledgerBoundariesMatch: RestoreObservation,
  balancesMatch: RestoreObservation,
  receiptsMatch: RestoreObservation,
  objectHashesMatch: RestoreObservation,
  artifactBytesMatch: RestoreObservation,
  readsWithoutEffects: RestoreObservation,
});

export type RestoreComparison = typeof RestoreComparison.Type;

export const RestoreAssertion = Schema.Struct({
  check: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  outcome: Schema.Literals(["passed", "failed", "unavailable"]),
});

export type RestoreAssertion = typeof RestoreAssertion.Type;

export const RestoreVerdict = Schema.Struct({
  assertions: Schema.Array(RestoreAssertion),
  restoreCertified: Schema.Boolean,
});

export type RestoreVerdict = typeof RestoreVerdict.Type;

export function verifyRestore(comparison: RestoreComparison): Checked<RestoreVerdict> {
  const observations = [
    ["schema_hashes", comparison.schemaHashesMatch],
    ["migration_hashes", comparison.migrationHashesMatch],
    ["entity_counts", comparison.entityCountsMatch],
    ["ledger_boundaries", comparison.ledgerBoundariesMatch],
    ["balances", comparison.balancesMatch],
    ["receipts", comparison.receiptsMatch],
    ["object_hashes", comparison.objectHashesMatch],
    ["artifact_bytes", comparison.artifactBytesMatch],
    ["reads_without_effects", comparison.readsWithoutEffects],
  ] as const;

  const assertions: Array<RestoreAssertion> = observations.map(([check, observation]) => ({
    check,
    outcome: observation === "unavailable" ? "unavailable" : observation ? "passed" : "failed",
  }));

  if (comparison.readsWithoutEffects === false) {
    return fail("FenceViolation", "Inspection reads created postings or external effects.");
  }

  if (assertions.some((assertion) => assertion.outcome === "failed")) {
    return fail("ControlDifference", "A restored control differs; the difference is retained.");
  }

  return Result.succeed({
    assertions,
    restoreCertified: assertions.every((assertion) => assertion.outcome === "passed"),
  });
}

export const DriftInput = Schema.Struct({
  destinationManifestDigest: Digest,
  backupManifestDigest: Digest,
});

export type DriftInput = typeof DriftInput.Type;

export function refuseDriftedRestore(input: DriftInput): Checked<typeof Digest.Type> {
  if (input.destinationManifestDigest !== input.backupManifestDigest) {
    return fail("MigrationDrift", "Migration drift stops the restore before any change.");
  }

  return Result.succeed(input.backupManifestDigest);
}

export const FenceProofInput = Schema.Struct({
  dispatchAttempted: Schema.Boolean,
  fenceDenied: Schema.Boolean,
});

export type FenceProofInput = typeof FenceProofInput.Type;

export function checkDispatchFence(input: FenceProofInput): Checked<typeof Identifier.Type> {
  if (!input.dispatchAttempted) {
    return fail("StaleEvidence", "No actual dispatch admission attempt was observed.");
  }

  if (!input.fenceDenied) {
    return fail("FenceViolation", "A restored job dispatched past its quarantine fence.");
  }

  return Result.succeed("fence-proof");
}
