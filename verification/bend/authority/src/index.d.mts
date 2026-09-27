import type { Engine } from "../lib/index.mjs";

export type CanonicalInteger = string;

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export type Digest = `sha256:${string}`;

export type VatRounding = "half_up" | "half_even" | "toward_zero" | "floor";

export type Rounding = VatRounding | "exact" | "ceiling";

export type VatBox = "05" | "10" | "11" | "12" | "48";

export interface CurrencyScope {
  readonly currency: string;
  readonly scale: number;
}

export interface RoundingInput {
  readonly numerator: CanonicalInteger;
  readonly denominator: CanonicalInteger;
  readonly rounding: Rounding;
}

export interface RoundingOutput {
  readonly roundedMinor: CanonicalInteger;
  readonly residualNumerator: CanonicalInteger;
  readonly denominator: CanonicalInteger;
}

export interface VatInput extends CurrencyScope {
  readonly reportingUnitMinor: CanonicalInteger;
  readonly rounding: VatRounding;
  readonly declareNet: boolean;
  readonly contributions: ReadonlyArray<{
    readonly id: string;
    readonly box: VatBox;
    readonly signedMinor: CanonicalInteger;
    readonly included: boolean;
  }>;
}

export interface VatRow {
  readonly box: VatBox | "49";
  readonly kind: "primitive" | "net";
  readonly exactMinor: CanonicalInteger;
  readonly reportedMinor: CanonicalInteger;
  readonly residualMinor: CanonicalInteger;
}

export interface ScheduleInput extends CurrencyScope {
  readonly remainingMinor: CanonicalInteger;
  readonly periodIds: readonly string[];
  readonly policy: "equal-magnitude-remainder-last-v1";
}

export interface AllocationInput extends CurrencyScope {
  readonly amountMinor: CanonicalInteger;
  readonly sourceRemainingMinor: CanonicalInteger;
  readonly targetRemainingMinor: CanonicalInteger;
}

export interface FxInput {
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly fromScale: number;
  readonly toScale: number;
  readonly amountMinor: CanonicalInteger;
  readonly rateNumerator: CanonicalInteger;
  readonly rateDenominator: CanonicalInteger;
  readonly rounding: Rounding;
  readonly rateConvention: "quote-major-per-base-major-v1";
}

export interface LedgerLine {
  readonly id: string;
  readonly accountId: string;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly debitMinor: CanonicalInteger;
  readonly creditMinor: CanonicalInteger;
}

export interface ReversalInput extends CurrencyScope {
  readonly originalVoucherId: string;
  readonly lines: readonly LedgerLine[];
}

export interface Inputs {
  "money.round.v1": RoundingInput;
  "vat.project.v1": VatInput;
  "schedule.equal.v1": ScheduleInput;
  "settlement.allocate.v1": AllocationInput;
  "fx.convert.v1": FxInput;
  "ledger.reverse.v1": ReversalInput;
}

export interface Outputs {
  "money.round.v1": RoundingOutput;
  "vat.project.v1": { readonly rows: readonly VatRow[] };
  "schedule.equal.v1": {
    readonly rows: ReadonlyArray<{
      readonly periodId: string;
      readonly amountMinor: CanonicalInteger;
    }>;
  };
  "settlement.allocate.v1": {
    readonly sourceAfterMinor: CanonicalInteger;
    readonly targetAfterMinor: CanonicalInteger;
  };
  "fx.convert.v1": {
    readonly convertedMinor: CanonicalInteger;
    readonly residualNumerator: CanonicalInteger;
    readonly denominator: CanonicalInteger;
  };
  "ledger.reverse.v1": {
    readonly lines: ReadonlyArray<Omit<LedgerLine, "id"> & { readonly originalLineId: string }>;
  };
}

export type Operation = keyof Inputs;

export interface Context {
  readonly entityId: string;
  readonly bookId: string;
  readonly snapshotId: string;
  readonly basisDigest: Digest;
  readonly ruleReleaseId: string;
  readonly ruleDigest: Digest;
  readonly profileVersion: string;
  readonly dependencies: ReadonlyArray<{ readonly resource: string; readonly revision: string }>;
}

export interface Request<K extends Operation> {
  readonly operation: K;
  readonly context: Context;
  readonly input: Inputs[K];
}

export interface Qualification {
  readonly status: "qualified-for-runtime";
  readonly releaseId: string;
  readonly manifestDigest: Digest;
  readonly artifactDigest: Digest;
  readonly sourceTreeDigest: Digest;
  readonly runtimeId: string;
  readonly operations: readonly Operation[];
  readonly semantics: Readonly<Record<string, string>>;
}

export interface Calculation<K extends Operation> extends Request<K> {
  readonly schema: "openerp-bend-calculation/v1";
  readonly owner: "bend";
  readonly output: Outputs[K];
  readonly semantics: string;
  readonly releaseId: string;
  readonly manifestDigest: Digest;
  readonly artifactDigest: Digest;
  readonly runtimeId: string;
  readonly inputDigest: Digest;
  readonly calculationDigest: Digest;
  readonly mayExecute: false;
}

export interface AuthorityService {
  readonly release: Qualification;
  calculate<K extends Operation>(operation: K, input: Inputs[K]): Outputs[K];
  prepare<K extends Operation>(request: Request<K>): Promise<Calculation<K>>;
}

export class KernelError extends Error {
  constructor(code: string, message: string, details?: Readonly<Record<string, Json>>);
  readonly code: string;
  readonly details: Readonly<Record<string, Json>>;
}

export function loadAuthority(options: {
  readonly manifestPath: string;
  readonly artifactPath: string;
  readonly trustPath: string;
  readonly runtimeId?: string;
}): Promise<AuthorityService>;
export function runtimeIdentity(): string;
export function canonical(value: unknown): string;
export function digest(value: unknown): Promise<Digest>;
export function digestBytes(bytes: Uint8Array): Promise<Digest>;
export function verifyRetained(value: unknown): Promise<Calculation<Operation>>;
export function assertExecutionBinding(
  value: unknown,
  binding: {
    readonly approvedCalculationDigest: Digest;
    readonly currentContext: Context;
    readonly allowedManifestDigests: readonly Digest[];
  },
): Promise<Calculation<Operation>>;
export function validateInput<K extends Operation>(operation: K, value: unknown): Inputs[K];
export function verifyOutput<K extends Operation>(
  operation: K,
  input: Inputs[K],
  value: unknown,
): Outputs[K];
export function checkRounding(
  numerator: bigint,
  denominator: bigint,
  quotient: bigint,
  remainder: bigint,
  rounding: Rounding,
): void;
export function reportingUnitFromScales(
  bookMinorScale: number,
  reportingDecimalPlaces: number,
): CanonicalInteger;
export function createVatMonetaryPort(service: AuthorityService): {
  readonly release: Qualification;
  round(numerator: bigint, denominator: bigint, rounding: VatRounding): bigint | null;
  project(input: VatInput): readonly VatRow[];
};

export const SEMANTICS: Readonly<Record<Operation, string>>;

export const AUTHORITY_OPERATIONS: readonly Operation[];

export function createShadowService(
  engine: Engine,
  legacy: (
    operation: Operation,
    input: Inputs[Operation],
  ) => Outputs[Operation] | Promise<Outputs[Operation]>,
): {
  compare<K extends Operation>(
    request: Request<K>,
  ): Promise<{
    readonly mode: "shadow";
    readonly authoritativeOwner: "typescript";
    readonly authoritative: Outputs[K];
    readonly candidate: Outputs[K] | null;
    readonly comparison: "equal" | "different" | "unavailable";
    readonly mayExecute: false;
  }>;
};
