/** Exact, bounded host contracts. These are not OpenERP's canonical digests. */
export class KernelError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "KernelError";
    this.code = code;
    this.details = details;
  }
}

export const fail = (code, message, details) => {
  throw new KernelError(code, message, details);
};

export const OPERATIONS = Object.freeze([
  "money.round.v1",
  "vat.project.v1",
  "schedule.equal.v1",
  "settlement.allocate.v1",
  "fx.convert.v1",
  "ledger.reverse.v1",
  "cover.suggest.v1",
]);

export function record(x, name = "value", allowed) {
  if (
    !x ||
    typeof x !== "object" ||
    Array.isArray(x) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(x))
  )
    fail("InvalidInput", `${name} must be a plain object`);

  if (Object.getOwnPropertySymbols(x).length)
    fail("InvalidInput", `${name} cannot have symbol keys`);

  for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(x))) {
    if (!Object.hasOwn(d, "value") || !d.enumerable)
      fail("InvalidInput", `${name}.${key} must be an enumerable data field`);

    if (allowed && !allowed.includes(key))
      fail("InvalidInput", `${name}.${key} is not a supported field`);
  }

  return x;
}

export function text(x, name, max = 200) {
  if (
    typeof x !== "string" ||
    !x.length ||
    x.length > max ||
    !x.isWellFormed() ||
    /[\p{ASCII}&&\p{Cc}]/v.test(x)
  )
    fail("InvalidInput", `${name} must be bounded well-formed text`);

  return x;
}

export function integer(x, name, min = 0, max = 10000) {
  if (!Number.isSafeInteger(x) || Object.is(x, -0) || x < min || x > max)
    fail("InvalidInput", `${name} must be an integer in [${min}, ${max}]`);

  return x;
}

export function boolean(x, name) {
  if (typeof x !== "boolean") fail("InvalidInput", `${name} must be explicit`);

  return x;
}

export function oneOf(x, choices, name) {
  if (!choices.includes(x)) fail("UnsupportedPolicy", `${name} is unsupported`);

  return x;
}

export function money(x, name = "amount", signed = false, digits = 38) {
  const syntax = signed ? /^(?:0|-?[1-9][0-9]*)$/u : /^(?:0|[1-9][0-9]*)$/u;

  if (
    typeof x !== "string" ||
    x.length > digits + (signed ? 1 : 0) ||
    !syntax.test(x) ||
    x.replace("-", "").length > digits
  )
    fail(
      "InvalidMoney",
      `${name} must be a canonical ${signed ? "signed" : "nonnegative"} integer string with at most ${digits} digits`,
    );

  return BigInt(x);
}

export function positive(x, name = "amount", digits = 38) {
  const n = money(x, name, false, digits);

  if (n === 0n) fail("InvalidMoney", `${name} must be positive`);

  return n;
}

export function currency(x, name = "currency") {
  if (typeof x !== "string" || !/^[A-Z]{3}$/u.test(x))
    fail("InvalidInput", `${name} must contain three uppercase letters`);

  return x;
}

export function array(x, name, max, min = 0) {
  if (!Array.isArray(x) || x.length < min || x.length > max || Object.keys(x).length !== x.length)
    fail("ResourceLimit", `${name} must have ${min} to ${max} dense entries`);

  if (Object.getOwnPropertySymbols(x).length)
    fail("InvalidInput", `${name} cannot have symbol fields`);
  const descriptors = Object.getOwnPropertyDescriptors(x);

  if (Object.keys(descriptors).length !== x.length + 1)
    fail("InvalidInput", `${name} has extra fields`);

  for (let i = 0; i < x.length; i++) {
    const d = descriptors[String(i)];

    if (!d || !Object.hasOwn(d, "value") || !d.enumerable)
      fail("InvalidInput", `${name} must contain data entries, not accessors`);
  }

  return x;
}

export function unique(xs, name) {
  if (new Set(xs).size !== xs.length) fail("InvalidInput", `${name} must be unique`);
}

export function sha(x, name) {
  if (typeof x !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(x))
    fail("InvalidInput", `${name} must be sha256:<64 lowercase hex digits>`);

  return x;
}

export function freeze(x) {
  if (x && typeof x === "object") {
    Object.values(x).forEach(freeze);
    Object.freeze(x);
  }

  return x;
}

/** Strict JSON snapshot: rejects undefined, getters, cycles, exotic objects and unsafe numbers. */
export function canonical(value) {
  const ancestors = new Set();
  let count = 0;

  function parseCanonicalValue(x, depth) {
    if (++count > 50000 || depth > 32)
      fail("ResourceLimit", "Canonical input exceeds structural bounds");

    if (x === null || typeof x === "boolean") return JSON.stringify(x);

    if (typeof x === "number") {
      integer(x, "JSON number", -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

      return String(x);
    }

    if (typeof x === "string") {
      if (x.length > 32768 || !x.isWellFormed()) fail("InvalidInput", "Invalid JSON string");

      return JSON.stringify(x);
    }

    if (typeof x !== "object") fail("InvalidInput", "Only exact JSON data may cross this boundary");

    if (ancestors.has(x)) fail("InvalidInput", "Cyclic input");
    ancestors.add(x);
    let out;

    if (Array.isArray(x)) {
      array(x, "JSON array", 10000);
      out = `[${x.map((v) => parseCanonicalValue(v, depth + 1)).join(",")}]`;
    } else {
      record(x);
      out = `{${Object.keys(x)
        .sort()
        .map((k) => {
          if (!k.isWellFormed()) fail("InvalidInput", "Invalid Unicode key");

          return `${JSON.stringify(k)}:${parseCanonicalValue(x[k], depth + 1)}`;
        })
        .join(",")}}`;
    }

    ancestors.delete(x);

    return out;
  }

  const out = parseCanonicalValue(value, 0);

  if (new TextEncoder().encode(out).length > 2_000_000)
    fail("ResourceLimit", "Canonical input exceeds 2 MB");

  return out;
}

export function snapshot(x) {
  return freeze(JSON.parse(canonical(x)));
}

export async function digestBytes(bytes) {
  return (
    "sha256:" +
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("")
  );
}

export const digest = (x) => digestBytes(new TextEncoder().encode(canonical(x)));

export function context(x) {
  record(x, "context", [
    "entityId",
    "bookId",
    "snapshotId",
    "basisDigest",
    "ruleReleaseId",
    "ruleDigest",
    "profileVersion",
    "dependencies",
  ]);

  for (const k of ["entityId", "bookId", "snapshotId", "ruleReleaseId", "profileVersion"])
    text(x[k], `context.${k}`);
  sha(x.basisDigest, "basisDigest");
  sha(x.ruleDigest, "ruleDigest");
  array(x.dependencies, "dependencies", 2000);

  for (const d of x.dependencies) {
    record(d, "dependency", ["resource", "revision"]);
    text(d.resource, "resource");
    text(d.revision, "revision");
  }

  unique(
    x.dependencies.map((d) => d.resource),
    "Dependency resources",
  );

  return x;
}

export const VAT_ROUNDING = Object.freeze(["half_up", "half_even", "toward_zero", "floor"]);

export const ROUNDING = Object.freeze([...VAT_ROUNDING, "exact", "ceiling"]);
