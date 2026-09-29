import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const read = async (name) =>
  JSON.parse(await readFile(new URL("../corpus/" + name, import.meta.url), "utf8"));

test("frozen canonical byte digests agree and vectors are nonempty", async () => {
  const { cases } = await read("canonical.json");
  assert.ok(cases.length >= 7);
  const ids = new Set();

  for (const x of cases) {
    assert.ok(!ids.has(x.id));
    ids.add(x.id);
    assert.equal(
      createHash("sha256").update(Buffer.from(x.expected, "utf8")).digest("hex"),
      x.sha256,
    );
    assert.deepEqual(JSON.parse(x.input), JSON.parse(x.expected));
  }
});

test("rounding corpus preserves exact mathematical envelope and sign cases", async () => {
  const { cases } = await read("rounding.json");
  assert.equal(cases.length, 420);
  const ids = new Set();

  for (const x of cases) {
    assert.ok(!ids.has(x.id));
    ids.add(x.id);

    const n = BigInt(x.n),
      d = BigInt(x.d);

    if (x.expected === null) {
      assert.equal(x.mode, "exact");
      assert.notEqual(n % d, 0n);
      continue;
    }

    const v = BigInt(x.expected),
      error = n - v * d;

    if (x.mode === "floor") assert.ok(error >= 0n && error < d);
    else if (x.mode === "toward_zero")
      assert.ok((error < 0n ? -error : error) < d && (n >= 0n ? error >= 0n : error <= 0n));
    else if (x.mode === "exact") assert.equal(error, 0n);
    else {
      assert.ok(2n * (error < 0n ? -error : error) <= d);

      if (x.mode === "half_even" && 2n * (error < 0n ? -error : error) === d)
        assert.equal(v % 2n, 0n);
    }
  }
});

test("release corpus groups conserve original capacities at their final boundary", async () => {
  const { cases } = await read("release.json");
  const groups = new Map();

  for (const x of cases) {
    const key = `${x.capacity}/${x.basis}/${x.mode}`;
    groups.set(key, (groups.get(key) || 0n) + BigInt(x.expected));
  }

  for (const [key, total] of groups) assert.equal(total, BigInt(key.split("/")[0]));
});

test("financial vector file is explicitly synthetic, not a statutory release", async () => {
  const f = await read("financial-vectors.json");
  assert.match(f.scope, /Synthetic/);
  assert.equal(f.vectors.length, 6);
  const purchase = f.vectors.find((v) => v.id === "PURCHASE-HALF-DEDUCTION");
  assert.equal(BigInt(purchase.expense) + BigInt(purchase.deductibleTax), BigInt(purchase.payable));
});
