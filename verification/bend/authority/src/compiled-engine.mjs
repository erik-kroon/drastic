import { fail } from "./contracts.mjs";

/** Adapter for the upstream Comp.js_lib ABI, not an interpreter or JS math port.
 * Constructor field metadata is emitted from the same checked Bend book.
 */
export function compiledEngine(exports, constructors) {
  if (!exports || typeof exports !== "object" || !constructors || typeof constructors !== "object")
    fail("InvalidArtifact", "Missing compiled exports or constructor metadata");

  const c = (name, ...values) => {
    const fields = constructors[name];

    if (!fields || fields.length !== values.length)
      fail("InvalidArtifact", `Constructor arity mismatch: ${name}`);

    return {
      $: name,
      ...Object.fromEntries(
        fields.map((k, i) => [
          k,
          values[i]?.__decodedBendNode === true ? values[i].raw : values[i],
        ]),
      ),
    };
  };

  const force = (value) => {
    // A decoded node can safely be inspected again by the legacy-neutral bridge.
    if (value?.__decodedBendNode === true) return value;
    const fields = value && constructors[value.$];

    if (!fields) fail("InvalidKernelOutput", `Unknown compiled constructor ${String(value?.$)}`);

    return {
      __decodedBendNode: true,
      raw: value,
      k: value.$,
      x: fields.map((name) => value[name]),
    };
  };

  const call = (name, ...args) => {
    if (typeof exports[name] !== "function")
      fail("InvalidArtifact", `Missing compiled function ${name}`);

    return force(exports[name](...args.map((v) => (v?.__decodedBendNode === true ? v.raw : v))));
  };

  const nat = (n) => {
    if (typeof n !== "bigint" || n < 0n) fail("InvalidMoney", "Expected nonnegative bigint");
    const bits = [];

    for (let v = n; v; v >>= 1n) bits.push(v & 1n);
    let node = c("BigNat.Zero");

    for (let i = bits.length - 1; i >= 0; i--)
      node = c(bits[i] ? "BigNat.Odd" : "BigNat.Even", node);

    return node;
  };

  const fromNat = (node) => {
    let value = 0n,
      shift = 0n,
      lastOdd = false;

    const seen = new Set();

    for (;;) {
      if (seen.has(node)) fail("InvalidKernelOutput", "Cyclic integer");
      seen.add(node);
      const x = force(node);

      if (x.k === "BigNat.Zero") {
        if (shift > 0n && !lastOdd) fail("InvalidKernelOutput", "Noncanonical high zero bit");

        return value;
      }

      if (!["BigNat.Odd", "BigNat.Even"].includes(x.k) || shift >= 16384n)
        fail("InvalidKernelOutput", "Malformed or oversized integer");
      lastOdd = x.k === "BigNat.Odd";

      if (lastOdd) value |= 1n << shift;
      shift++;
      node = x.x[0];
    }
  };

  const flag = (b) => c(b ? "Foundation.Yes" : "Foundation.No");
  const integer = (n) => c("BigInt.Integer", flag(n < 0n), nat(n < 0n ? -n : n));

  const fromInteger = (node) => {
    const x = force(node);

    if (x.k !== "BigInt.Integer") fail("InvalidKernelOutput", "Not a signed integer");
    const sign = force(x.x[0]).k;

    if (!["Foundation.No", "Foundation.Yes"].includes(sign))
      fail("InvalidKernelOutput", "Invalid sign");
    const magnitude = fromNat(x.x[1]);

    if (magnitude === 0n && sign === "Foundation.Yes")
      fail("InvalidKernelOutput", "Negative zero in compiled output");

    return (sign === "Foundation.Yes" ? -1n : 1n) * magnitude;
  };

  const count = (n) => {
    if (!Number.isSafeInteger(n) || n < 0 || n > 100000) fail("ResourceLimit", "Invalid count");
    let x = c("Foundation.Stop");

    for (let i = 0; i < n; i++) x = c("Foundation.Tick", x);

    return x;
  };

  const fromCount = (node) => {
    for (let n = 0; n <= 100000; n++) {
      const x = force(node);

      if (x.k === "Foundation.Stop") return n;

      if (x.k !== "Foundation.Tick") fail("InvalidKernelOutput", "Not a count");
      node = x.x[0];
    }

    fail("ResourceLimit", "Count exceeded limit");
  };

  return Object.freeze({
    c,
    force,
    call,
    nat,
    fromNat,
    flag,
    integer,
    fromInteger,
    count,
    fromCount,
    authority: "official-js-artifact",
  });
}
