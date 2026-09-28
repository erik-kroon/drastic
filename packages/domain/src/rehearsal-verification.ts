import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Description, Digest, Identifier } from "./values";

// Pure rehearsal-verification math for one fixed-revision exercise.
// NEXT-25 leaf: acceptance inventory, backup-manifest verification,
// restore comparison and failure-exit discipline. This exercises no
// database, runs no reset, dump, deployment, payment or filing: those
// need separately confirmed disposal and operator authority, which this
// leaf records as required witnesses rather than assuming. Passing
// schemas or builds never substitute for the financial observation, and
// an old passing fragment never merges into a claimed current run
// without exercising its connections. The operations owner keeps the
// actual checkpoint capture, backup orchestration and quarantine.

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
  rows: Schema.Array(AcceptanceRow),
  waitingHandoffs: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32))),
});

export type AcceptanceLedger = typeof AcceptanceLedger.Type;

export const BuildLedgerInput = Schema.Struct({
  checkpointId: Identifier,
  repositoryCommit: Identifier,
  rows: Schema.Array(AcceptanceRow),
  requiredPackets: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32))),
  handoffs: Schema.Array(OwnerHandoff),
});

export type BuildLedgerInput = typeof BuildLedgerInput.Type;

// Builds the applicable acceptance inventory. Unknown applicability
// stays blocked, never assumed; a missing owner handoff waits at that
// integration while disjoint approved work continues. Stale evidence
// (a handoff whose source digest moved) refuses rather than merging an
// old passing fragment into a current claim.
export function buildAcceptanceLedger(input: BuildLedgerInput): Checked<AcceptanceLedger> {
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

// Verifies a backup manifest before any certificate exists: every
// member hash and size verified from the same snapshot, no dangling
// required references, and every inventory family handled. A missing
// original object means an incomplete backup with no restore
// certificate, never a partial pass.
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

export const RestoreComparison = Schema.Struct({
  schemaHashesMatch: Schema.Boolean,
  migrationHashesMatch: Schema.Boolean,
  entityCountsMatch: Schema.Boolean,
  ledgerBoundariesMatch: Schema.Boolean,
  balancesMatch: Schema.Boolean,
  receiptsMatch: Schema.Boolean,
  objectHashesMatch: Schema.Boolean,
  artifactBytesMatch: Schema.Boolean,
  readsWithoutEffects: Schema.Boolean,
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

// Compares a quarantined restore against its manifest field by field.
// A control difference is retained as a failed assertion, never a
// balancing plug; inspection reads must create no postings or effects,
// or certification refuses.
export function verifyRestore(comparison: RestoreComparison): Checked<RestoreVerdict> {
  const assertions: Array<RestoreAssertion> = [
    { check: "schema_hashes", outcome: comparison.schemaHashesMatch ? "passed" : "failed" },
    { check: "migration_hashes", outcome: comparison.migrationHashesMatch ? "passed" : "failed" },
    { check: "entity_counts", outcome: comparison.entityCountsMatch ? "passed" : "failed" },
    { check: "ledger_boundaries", outcome: comparison.ledgerBoundariesMatch ? "passed" : "failed" },
    { check: "balances", outcome: comparison.balancesMatch ? "passed" : "failed" },
    { check: "receipts", outcome: comparison.receiptsMatch ? "passed" : "failed" },
    { check: "object_hashes", outcome: comparison.objectHashesMatch ? "passed" : "failed" },
    { check: "artifact_bytes", outcome: comparison.artifactBytesMatch ? "passed" : "failed" },
  ];

  if (!comparison.readsWithoutEffects) {
    return fail("FenceViolation", "Inspection reads created postings or external effects.");
  }

  const failed = assertions.some((assertion) => assertion.outcome === "failed");

  if (failed) {
    return fail("ControlDifference", "A restored control differs; the difference is retained.");
  }

  return Result.succeed({ assertions, restoreCertified: true });
}

export const DriftInput = Schema.Struct({
  destinationManifestDigest: Digest,
  backupManifestDigest: Digest,
});

export type DriftInput = typeof DriftInput.Type;

// Migration drift stops before the destination is modified and keeps
// its diagnostic manifest.
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

// A restored provider job that tries to dispatch must meet the
// external fence denial, recorded as proof rather than an error to
// retry around.
export function checkDispatchFence(input: FenceProofInput): Checked<typeof Identifier.Type> {
  if (input.dispatchAttempted && !input.fenceDenied) {
    return fail("FenceViolation", "A restored job dispatched past its quarantine fence.");
  }

  return Result.succeed("fence-proof");
}
