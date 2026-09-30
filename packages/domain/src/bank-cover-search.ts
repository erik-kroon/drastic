import * as Schema from "effect/Schema";
import { SignedMinorUnits } from "./money";
import { Identifier } from "./values";

export const CoverLimits = Schema.Struct({
  maxCandidates: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 40 })),
  maxSetSize: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })),
  maxVisited: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
});

export const CoverLeg = Schema.Struct({
  voucherId: Identifier,
  lineId: Identifier,
  amountMinor: SignedMinorUnits,
});

export const ExactCover = Schema.Struct({
  legs: Schema.Array(CoverLeg).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  totalMinor: SignedMinorUnits,
  leftoverMinor: Schema.Literal("0"),
  maximumDayDistance: Schema.Int,
});

export const CoverSearch = Schema.Struct({
  status: Schema.Literals([
    "unique_within_declared_pool",
    "ambiguous",
    "no_match_within_declared_pool",
    "incomplete_search",
    "unavailable",
  ]),
  limits: CoverLimits,
  populationCount: Schema.Int,
  searchedCount: Schema.Int,
  visited: Schema.Int,
  poolComplete: Schema.Boolean,
  searchedSetSize: Schema.Int,
  limitReasons: Schema.Array(
    Schema.Literals(["candidate_limit", "visit_budget", "alternative_limit"]),
  ),
  rankingPolicy: Schema.Literal("fewest_lines_then_smallest_maximum_day_gap_v1"),
  covers: Schema.Array(ExactCover).check(Schema.isMaxLength(100)),
});

type Candidate = typeof CoverLeg.Type & { readonly dayDistance: number };

type Limits = typeof CoverLimits.Type;

const absolute = (amount: bigint) => (amount < 0n ? -amount : amount);

// Same-sign whole residuals only. Stable identity order is reproducibility,
// never a tie-breaker between different economic explanations.
export function findExactCovers(
  targetMinor: string,
  candidates: ReadonlyArray<Candidate>,
  limits: Limits,
  available: boolean,
): typeof CoverSearch.Type {
  const target = BigInt(targetMinor);

  const pool = [...candidates].sort((left, right) => {
    const a = JSON.stringify([left.voucherId, left.lineId]);
    const b = JSON.stringify([right.voucherId, right.lineId]);

    return a < b ? -1 : a > b ? 1 : 0;
  });

  const identities = new Set(pool.map((line) => JSON.stringify([line.voucherId, line.lineId])));

  const valid =
    identities.size === pool.length &&
    pool.every((line) => {
      const amount = BigInt(line.amountMinor);

      return amount !== 0n && amount > 0n === target > 0n;
    });

  const searched = pool.slice(0, limits.maxCandidates);
  const reasons: Array<(typeof CoverSearch.Type)["limitReasons"][number]> = [];

  if (pool.length > searched.length) reasons.push("candidate_limit");
  let visited = 0;
  let exhausted = false;
  let overflow = false;
  let searchedSetSize = 0;
  let bestGap = Infinity;
  let covers: Array<typeof ExactCover.Type> = [];
  const path: Array<Candidate> = [];
  const magnitude = absolute(target);

  function visit(start: number, remainingSlots: number, sum: bigint, gap: number): void {
    if (exhausted) return;

    if (visited >= limits.maxVisited) {
      exhausted = true;

      return;
    }

    visited += 1;

    if (remainingSlots === 0) {
      if (sum !== magnitude || gap > bestGap) return;

      if (gap < bestGap) {
        bestGap = gap;
        covers = [];
        overflow = false;
      }

      if (covers.length >= 100) {
        overflow = true;

        return;
      }

      covers.push({
        legs: path.map(({ voucherId, lineId, amountMinor }) => ({
          voucherId,
          lineId,
          amountMinor,
        })),
        totalMinor: targetMinor,
        leftoverMinor: "0",
        maximumDayDistance: gap,
      });

      return;
    }

    if (sum >= magnitude || searched.length - start < remainingSlots) return;

    for (let index = start; index <= searched.length - remainingSlots; index += 1) {
      const candidate = searched[index];

      if (!candidate) continue;
      const next = sum + absolute(BigInt(candidate.amountMinor));

      if (next > magnitude) continue;
      path.push(candidate);
      visit(index + 1, remainingSlots - 1, next, Math.max(gap, candidate.dayDistance));
      path.pop();

      if (exhausted) break;
    }
  }

  if (available && target !== 0n && valid) {
    for (let size = 1; size <= Math.min(limits.maxSetSize, searched.length); size += 1) {
      searchedSetSize = size;
      visit(0, size, 0n, 0);

      if (covers.length > 0 || exhausted) break;
    }
  }

  if (exhausted) reasons.push("visit_budget");

  if (overflow) reasons.push("alternative_limit");
  const unavailable = !available || target === 0n || !valid;

  return {
    status: unavailable
      ? "unavailable"
      : reasons.length
        ? "incomplete_search"
        : covers.length === 1
          ? "unique_within_declared_pool"
          : covers.length > 1
            ? "ambiguous"
            : "no_match_within_declared_pool",
    limits,
    populationCount: pool.length,
    searchedCount: searched.length,
    visited,
    poolComplete: reasons.length === 0,
    searchedSetSize,
    limitReasons: reasons,
    rankingPolicy: "fewest_lines_then_smallest_maximum_day_gap_v1",
    covers,
  };
}
