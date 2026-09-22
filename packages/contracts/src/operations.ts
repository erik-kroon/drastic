import * as Schema from "effect/Schema";

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Count = Schema.String.check(Schema.isPattern(/^[0-9]+$/));
const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,62}$/));

export const LocalTarget = Schema.Struct({
  version: Schema.Literal(1),
  dataClass: Schema.Literal("synthetic-local-only"),
  host: Schema.Literal("127.0.0.1"),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 })),
  database: Name,
  user: Name,
  password: Schema.String.check(Schema.isMinLength(1)),
  expectedSystemIdentifier: Count,
  pgBinDirectory: Schema.String,
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export const TableFingerprint = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
  rows: Count,
  sha256: Digest,
});
export const BookBoundary = Schema.Struct({
  id: Schema.String,
  authority: Schema.Literals(["native", "legacy"]),
  writerEpoch: Count,
  committedSequence: Count,
});
export const LocalPreflight = Schema.Struct({
  version: Schema.Literal(1),
  checkedAt: Schema.String,
  database: Schema.String,
  systemIdentifier: Count,
  serverVersion: Schema.String,
  books: Schema.Array(BookBoundary),
  otherSessions: Schema.Int,
  pendingOutbox: Count,
  unconsumedApprovals: Count,
  singleWriterObservation: Schema.Literals(["native-epochs-observed", "blocked"]),
  writeFreeze: Schema.Literal("not-established"),
  productionAction: Schema.Literal("disabled"),
  blockers: Schema.Array(Schema.String),
});
export const BackupFile = Schema.Struct({
  path: Schema.String,
  bytes: Count,
  sha256: Digest,
});
export const RecoveryArtifact = Schema.Struct({
  ...BackupFile.fields,
  kind: Schema.Literals(["evidence", "rule", "filing", "configuration", "key-recovery"]),
  referenceId: Schema.String.check(Schema.isMinLength(1)),
});
export const ConfigurationCustody = Schema.Struct({
  name: Schema.Literals(["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]),
  custodyReference: Schema.String.check(Schema.isMinLength(1)),
  procedurePath: Schema.String.check(Schema.isMinLength(1)),
});
export const RecoveryPlan = Schema.Struct({
  version: Schema.Literal(1),
  operatorId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  releaseDirectory: Schema.String,
  supplementaryDirectory: Schema.String,
  artifacts: Schema.Array(RecoveryArtifact),
  configuration: Schema.Array(ConfigurationCustody),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export const ReleaseManifest = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("openerp-source-release"),
  capturedAt: Schema.String,
  files: Schema.Array(BackupFile),
  databaseAdapter: Schema.Literal("drizzle-effect-postgres"),
  browserAuthentication: Schema.Literal("better-auth"),
  runtimeVerification: Schema.Literal("not-run"),
});
export const RoleInventory = Schema.Struct({
  name: Schema.String,
  superuser: Schema.Boolean,
  inherit: Schema.Boolean,
  createRole: Schema.Boolean,
  createDatabase: Schema.Boolean,
  login: Schema.Boolean,
  replication: Schema.Boolean,
  bypassRls: Schema.Boolean,
  connectionLimit: Schema.Int,
  expiresAt: Schema.NullOr(Schema.String),
  memberships: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      grantor: Schema.String,
      admin: Schema.Boolean,
      inherit: Schema.Boolean,
      set: Schema.Boolean,
    }),
  ),
});
export const DatabaseInventory = Schema.Struct({
  owner: Schema.String,
  encoding: Schema.String,
  collation: Schema.String,
  ctype: Schema.String,
  localeProvider: Schema.Literal("c"),
  schemaSha256: Digest,
  extensions: Schema.Array(Schema.Struct({ name: Schema.String, version: Schema.String })),
  migrations: Schema.Array(Schema.Struct({ name: Schema.String, sha256: Digest })),
  roles: Schema.Array(RoleInventory),
});
export const RecoveryControls = Schema.Struct({
  evidenceCount: Count,
  evidenceBytes: Count,
  jsonEvidenceReferences: Count,
  voucherCount: Count,
  executionReceiptCount: Count,
  commandReceiptCount: Count,
  reportCount: Count,
  ledgerDebitMinor: Count,
  ledgerCreditMinor: Count,
  inlineEvidenceClosure: Schema.Literal("matched"),
  receiptLinks: Schema.Literal("matched"),
  historicalReportControls: Schema.Literal("matched"),
  externalObjects: Schema.Literal("unsupported-pointers-refused"),
});
export const BackupManifest = Schema.Struct({
  version: Schema.Literal(2),
  kind: Schema.Literal("openerp-local-backup"),
  dataClass: Schema.Literal("synthetic-local-only"),
  createdAt: Schema.String,
  operatorId: Schema.String,
  source: LocalPreflight,
  snapshot: Schema.String,
  tables: Schema.Array(TableFingerprint),
  inventory: DatabaseInventory,
  controls: RecoveryControls,
  release: ReleaseManifest,
  configuration: Schema.Array(ConfigurationCustody),
  artifacts: Schema.Array(RecoveryArtifact),
  files: Schema.Array(BackupFile),
  evidenceAndReceipts: Schema.Literal("all-user-tables-in-snapshot"),
  archiveCompliance: Schema.Literal("not-established"),
  keyRecovery: Schema.Literal("custody-declared-not-exercised"),
  restoreStatus: Schema.Literal("not-exercised"),
  productionAction: Schema.Literal("disabled"),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export const RestoreReceipt = Schema.Struct({
  version: Schema.Literal(2),
  kind: Schema.Literal("openerp-local-restore"),
  completedAt: Schema.String,
  durationMs: Schema.Int,
  operatorId: Schema.String,
  manifestSha256: Digest,
  destination: Schema.String,
  systemIdentifier: Count,
  controls: RecoveryControls,
  tableFingerprints: Schema.Literal("matched"),
  migrationFiles: Schema.Literal("matched"),
  roleAttributesAndMemberships: Schema.Literal("matched-before-restore"),
  supplementaryFiles: Schema.Literal("matched"),
  configurationRecovery: Schema.Literal("custody-declared-not-exercised"),
  connections: Schema.Literal("disabled"),
  writerPromotion: Schema.Literal("not-performed"),
  applicationRecovery: Schema.Literal("blocked-restricted-read-admission"),
  archiveCompliance: Schema.Literal("not-established"),
  productionAction: Schema.Literal("disabled"),
});
export const OperationDiagnostic = Schema.Struct({
  version: Schema.Literal(1),
  stage: Schema.String,
  recordedAt: Schema.String,
  status: Schema.Literals(["started", "passed", "failed", "not-confirmed"]),
  message: Schema.String,
});
