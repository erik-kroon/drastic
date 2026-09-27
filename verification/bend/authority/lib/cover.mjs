import { createHash } from "node:crypto";
import { minor } from "./money.mjs";

const text = (v, name) => {
  if (typeof v !== "string" || v.length === 0 || v.length > 200)
    throw new TypeError(`${name} must be a nonempty bounded string`);

  return v;
};

const bounded = (v, max, name) => {
  if (!Number.isSafeInteger(v) || v < 0 || v > max)
    throw new RangeError(`${name} must be between 0 and ${max}`);

  return v;
};

const sameScope = (a, b) =>
  a.entityId === b.entityId && a.bookId === b.bookId && a.snapshotId === b.snapshotId;

function scope(v) {
  if (!v || typeof v !== "object") throw new TypeError("scope is required");

  return {
    entityId: text(v.entityId, "entityId"),
    bookId: text(v.bookId, "bookId"),
    snapshotId: text(v.snapshotId, "snapshotId"),
  };
}

export function validateCoverRequest(input) {
  if (!input || typeof input !== "object") throw new TypeError("Request object required");
  const requestScope = scope(input.scope);
  const currency = text(input.currency, "currency");

  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError("Currency must be three uppercase letters");
  const scale = bounded(input.scale, 6, "scale");

  if (!["inflow", "outflow"].includes(input.direction))
    throw new TypeError("Explicit inflow/outflow direction required");

  if (typeof input.poolComplete !== "boolean") throw new TypeError("poolComplete must be explicit");
  const target = minor(input.targetMinor);

  if (target === 0n) throw new RangeError("A nonzero target is required");

  if (!Array.isArray(input.candidates) || input.candidates.length > 64)
    throw new RangeError("Maximum 64 candidates; do not silently truncate the pool");
  const ids = new Set();

  const candidates = input.candidates
    .map((c) => {
      const id = text(c.id, "candidate.id");

      if (ids.has(id)) throw new TypeError(`Duplicate candidate ID: ${id}`);
      ids.add(id);
      const cscope = scope(c.scope);

      if (!sameScope(cscope, requestScope))
        throw new TypeError(`Stale or cross-book candidate: ${id}`);

      if (c.currency !== currency || c.scale !== scale || c.direction !== input.direction)
        throw new TypeError(`Mismatched monetary scope: ${id}`);
      const amount = minor(c.remainingMinor);

      if (amount === 0n)
        throw new RangeError("Zero remaining capacities must be excluded by the eligibility owner");

      return {
        id,
        remainingMinor: c.remainingMinor,
        revision: text(c.revision, "revision"),
        scope: cscope,
        currency,
        scale,
        direction: c.direction,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const maxCardinality = bounded(input.limits?.maxCardinality, 64, "maxCardinality");
  const nodeBudget = bounded(input.limits?.nodeBudget, 100_000, "nodeBudget");

  return {
    scope: requestScope,
    currency,
    scale,
    direction: input.direction,
    targetMinor: input.targetMinor,
    poolComplete: input.poolComplete,
    candidates,
    limits: { maxCardinality, nodeBudget },
  };
}

/** Test/research adapter. It never posts, approves or consumes capacity. */
export function solveCover(engine, input) {
  const request = validateCoverRequest(input);

  const fingerprint =
    "verification-sha256:" + createHash("sha256").update(JSON.stringify(request)).digest("hex");

  const base = {
    engine: "bend-cover-v1",
    authority: engine?.authority ?? "unavailable",
    inputFingerprint: fingerprint,
    scope: request.scope,
    currency: request.currency,
    scale: request.scale,
    direction: request.direction,
    targetMinor: request.targetMinor,
    mayExecute: false,
    requiresRevalidation: true,
    coverage: {
      poolCompleteDeclared: request.poolComplete,
      candidateCount: request.candidates.length,
      maxCardinality: request.limits.maxCardinality,
      nodeBudget: request.limits.nodeBudget,
    },
  };

  try {
    if (!engine) throw new Error("No Bend engine");
    let candidates = engine.c("Cover.NoCandidates");

    for (let i = request.candidates.length - 1; i >= 0; i--)
      candidates = engine.c(
        "Cover.Candidate",
        engine.nat(BigInt(i)),
        engine.nat(BigInt(request.candidates[i].remainingMinor)),
        candidates,
      );

    const result = engine.call(
      "Cover.solve",
      engine.nat(BigInt(request.targetMinor)),
      candidates,
      engine.count(request.limits.maxCardinality),
      engine.count(request.limits.nodeBudget),
    );

    const decodeSelection = (term) => {
      let tail = term,
        sum = 0n;

      const indexes = new Set();
      const selected = [];

      for (;;) {
        const row = engine.force(tail);

        if (row.k === "Cover.NothingSelected") break;

        if (row.k !== "Cover.Selected") throw new Error("Malformed selection");
        const index = engine.fromNat(row.x[0]);

        if (index >= BigInt(request.candidates.length)) throw new Error("Unknown candidate index");
        const i = Number(index);

        if (indexes.has(i)) throw new Error("Repeated candidate in witness");
        indexes.add(i);

        const candidate = request.candidates[i],
          amount = engine.fromNat(row.x[1]);

        if (amount !== BigInt(candidate.remainingMinor))
          throw new Error("Witness changed capacity");
        sum += amount;
        selected.push({
          id: candidate.id,
          revision: candidate.revision,
          amountMinor: amount.toString(),
        });
        tail = row.x[2];
      }

      if (
        sum !== BigInt(request.targetMinor) ||
        selected.length === 0 ||
        selected.length > request.limits.maxCardinality
      )
        throw new Error("Invalid covering witness");

      return selected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    };

    let witnesses = [],
      visited = 0,
      exhaustive = false;

    if (result.k === "Cover.Ambiguous") {
      witnesses = [decodeSelection(result.x[0]), decodeSelection(result.x[1])];
      visited = engine.fromCount(result.x[2]);
    } else if (result.k === "Cover.Complete" || result.k === "Cover.Incomplete") {
      exhaustive = result.k === "Cover.Complete";
      visited = engine.fromCount(result.x[1]);
      const solutions = engine.force(result.x[0]);

      if (solutions.k === "Cover.OneFound") witnesses = [decodeSelection(solutions.x[0])];
      else if (solutions.k === "Cover.TwoFound")
        witnesses = [decodeSelection(solutions.x[0]), decodeSelection(solutions.x[1])];
      else if (solutions.k !== "Cover.NoneFound") throw new Error("Malformed solution count");
    } else throw new Error(`Unexpected solver state: ${result.k}`);

    if (visited > request.limits.nodeBudget) throw new Error("Global node budget exceeded");

    if (witnesses.length === 2 && JSON.stringify(witnesses[0]) === JSON.stringify(witnesses[1]))
      throw new Error("Ambiguity requires two distinct witnesses");
    const complete = exhaustive && request.poolComplete;

    const status =
      witnesses.length === 2
        ? "ambiguous"
        : !complete
          ? "incomplete"
          : witnesses.length === 1
            ? "unique-within-scope"
            : "no-match-within-scope";

    const response = {
      ...base,
      status,
      witnesses,
      coverage: { ...base.coverage, visitedNodes: visited, searchExhausted: exhaustive },
    };

    if (status === "incomplete") {
      response.reason = !request.poolComplete
        ? "candidate-pool-incomplete"
        : "node-budget-exhausted";
    }

    return response;
  } catch (e) {
    return {
      ...base,
      status: "unavailable",
      witnesses: [],
      reason: "engine-or-witness-validation-failed",
      detail: String(e.message ?? e),
    };
  }
}
