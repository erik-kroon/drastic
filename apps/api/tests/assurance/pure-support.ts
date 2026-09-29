import * as Result from "effect/Result";
import { expect } from "vitest";

/** Unwrap only the result under test. Expected values must come from fixtures or an independent oracle. */
export function succeeded<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result))
    throw new Error(`Expected success, received ${JSON.stringify(result.failure)}`);

  return result.success;
}

export function failedWith<A, E extends { readonly code: string }>(
  result: Result.Result<A, E>,
  code: string,
) {
  expect(Result.isFailure(result)).toBe(true);

  if (Result.isFailure(result)) expect(result.failure.code).toBe(code);
}

export function independentJournalTotals(
  lines: ReadonlyArray<{
    readonly accountId: string;
    readonly debitMinor: string;
    readonly creditMinor: string;
  }>,
) {
  const totals = new Map<string, bigint>();

  for (const line of lines) {
    const debit = BigInt(line.debitMinor);
    const credit = BigInt(line.creditMinor);
    expect((debit > 0n && credit === 0n) || (credit > 0n && debit === 0n)).toBe(true);
    totals.set(line.accountId, (totals.get(line.accountId) ?? 0n) + debit - credit);
  }

  expect([...totals.values()].reduce((a, b) => a + b, 0n)).toBe(0n);

  return Object.fromEntries(
    [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.toString()]),
  );
}
