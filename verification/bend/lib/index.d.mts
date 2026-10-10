/** Research/verification evaluator, not a financial writer or production runtime. */
export interface BendTerm {
  readonly $: string;
  readonly k?: string;
  readonly x?: readonly BendTerm[];
}

export interface Engine {
  readonly authority: "development-adaptation" | "pinned-upstream-source";
  readonly definitions: number;
  call(name: string, ...args: BendTerm[]): BendTerm;
  force(term: BendTerm): BendTerm;
  c(name: string, ...fields: BendTerm[]): BendTerm;
  nat(value: bigint): BendTerm;
  fromNat(value: BendTerm): bigint;
  integer(value: bigint): BendTerm;
  fromInteger(value: BendTerm): bigint;
  flag(value: boolean): BendTerm;
  count(value: number): BendTerm;
  fromCount(value: BendTerm): number;
}

export function loadEngine(entry?: string): Promise<Engine>;
export function minor(value: string, options?: { signed?: boolean; maxDigits?: number }): bigint;

export type RoundingMode =
  | "exact"
  | "toward_zero"
  | "floor"
  | "ceiling"
  | "half_even"
  | "half_away"
  | "half_up";

export function roundReference(
  n: bigint,
  d: bigint,
  mode: RoundingMode,
): null | { value: bigint; residual: bigint; denominator: bigint };

export interface VoucherLine {
  readonly debitMinor: string;
  readonly creditMinor: string;
}

export function validateVoucher(
  engine: Engine,
  lines: readonly VoucherLine[],
): {
  accepted: boolean;
  debitMinor: string;
  creditMinor: string;
  scopeChecked: false;
  postingAuthorized: false;
};

export interface AllocationRequest {
  readonly amountMinor: string;
  readonly sourceRemainingMinor: string;
  readonly targetRemainingMinor: string;
}

export type AllocationResult =
  | {
      status: "allocated-arithmetic";
      amountMinor: string;
      sourceAfterMinor: string;
      targetAfterMinor: string;
      restoredSourceMinor: string;
      restoredTargetMinor: string;
      mayExecute: false;
    }
  | { status: "ZeroAmount" | "CapacityExceeded" | "ConservationFailure"; mayExecute: false };

export function allocate(engine: Engine, request: AllocationRequest): AllocationResult;

export interface VatRequest {
  readonly contributions: readonly {
    box: "05" | "10" | "11" | "12" | "48";
    signedMinor: string;
    included: boolean;
  }[];
  readonly filingUnitScale: number;
  readonly rounding: "half_up" | "half_even" | "toward_zero" | "floor";
  readonly declareNet: boolean;
}

export interface VatRow {
  box: "05" | "10" | "11" | "12" | "48" | "49";
  kind: "primitive" | "net";
  exactMinor: string;
  reportedMinor: string;
  residualMinor: string;
}

export function calculateVat(engine: Engine, input: VatRequest): VatRow[];

export interface Scope {
  readonly entityId: string;
  readonly bookId: string;
  readonly snapshotId: string;
}

export interface Candidate {
  readonly id: string;
  readonly revision: string;
  readonly scope: Scope;
  readonly currency: string;
  readonly scale: number;
  readonly direction: "inflow" | "outflow";
  readonly remainingMinor: string;
}

export interface CoverRequest {
  readonly scope: Scope;
  readonly currency: string;
  readonly scale: number;
  readonly direction: "inflow" | "outflow";
  readonly targetMinor: string;
  readonly poolComplete: boolean;
  readonly candidates: readonly Candidate[];
  readonly limits: { readonly maxCardinality: number; readonly nodeBudget: number };
}

export interface CoverResult {
  status:
    | "unique-within-scope"
    | "ambiguous"
    | "no-match-within-scope"
    | "incomplete"
    | "unavailable";
  engine: string;
  authority: string;
  inputFingerprint: string;
  scope: Scope;
  currency: string;
  scale: number;
  direction: "inflow" | "outflow";
  targetMinor: string;
  mayExecute: false;
  requiresRevalidation: true;
  witnesses: { id: string; revision: string; amountMinor: string }[][];
  coverage: {
    poolCompleteDeclared: boolean;
    candidateCount: number;
    maxCardinality: number;
    nodeBudget: number;
    visitedNodes?: number;
    searchExhausted?: boolean;
  };
  reason?: string;
  detail?: string;
}

export function validateCoverRequest(input: CoverRequest): CoverRequest;
export function solveCover(engine: Engine | null, input: CoverRequest): CoverResult;
