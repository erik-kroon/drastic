export interface Specification {
    netMinor?: string;
    deductionDenominator?: string;
    maxEvents?: number;
}
export type Event = {
    kind: 'recognize';
    id: string;
} | {
    kind: 'pay' | 'refund';
    id: string;
    amountMinor: string;
} | {
    kind: 'credit';
    id: string;
    netMinor: string;
};
export interface Row {
    accountId: string;
    signedMinor: string;
}
export interface State {
    N: bigint;
    T: bigint;
    D: bigint;
    G: bigint;
    creditNet: bigint;
    creditTax: bigint;
    releasedDeduction: bigint;
    paid: bigint;
    refunded: bigint;
    ids: string[];
    recognized: boolean;
    effects: Array<{
        id: string;
        kind: Event['kind'];
        rows: Row[];
    }>;
}
export interface Trace {
    schema: 'assurance-supplier-history/v1';
    seed: number;
    specification: Specification;
    events: Event[];
}
export class ModelRefusal extends Error {
    code: string;
    constructor(code: string);
}
export function createModel(spec?: Specification): State;
export function advance(state: State, event: Event): State;
export function balances(state: State): Record<string, string>;
export function position(state: State): {
    gross: string;
    credited: string;
    paid: string;
    refunded: string;
    unpaid: string;
    refundPrincipal: string;
    refundDue: string;
};
export function generator(seed: number): () => number;
export function generateHistory(seed: number, spec?: Specification): Trace;
export function replayModel(trace: Trace): State;
export function shrinkCandidates(trace: Trace): Trace[];
export function canonicalRows(rows: Row[]): Row[];
export function assertExactRows(actual: Row[], expected: Row[]): void;
