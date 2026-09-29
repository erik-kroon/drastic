import { expect, test } from "vitest";
import * as Effect from "effect/Effect";
import * as Shared from "../../src/application/banking/shared";

// [EXC-BANK-JSON-SHAPE] A retained array must not be encoded through the
// object-only contract. Bank inventory sign-off members and bank match reversal
// legs are both Schema.Array values; passing either to toJsonObject turned a
// real stored list into InternalError at runtime.
const encoded = <A>(program: Effect.Effect<A, unknown>) => Effect.runPromise(program);

test("[EXC-BANK-JSON-SHAPE] retained bank arrays encode as JSON arrays, not rejected objects", async () => {
  const members = [
    { accountId: "account_bank", plan: { id: "plan_1" }, signoff: { id: "sign_1" } },
    { accountId: "account_clearing", plan: { id: "plan_2" }, signoff: { id: "sign_2" } },
  ];

  const membersBody = await encoded(Shared.toJson(members));
  expect(Array.isArray(membersBody)).toBe(true);
  expect(membersBody).toEqual(members);

  const legs = [
    { sourceMinor: "12500", targetMinor: "12500", targetAccountId: "account_clearing" },
  ];

  const legsBody = await encoded(Shared.toJson(legs));
  expect(Array.isArray(legsBody)).toBe(true);
  expect(legsBody).toEqual(legs);
});

test("[EXC-BANK-JSON-SHAPE] a genuine object still encodes through the object-only contract", async () => {
  const body = await encoded(Shared.toJsonObject({ accountId: "account_bank", count: 2 }));
  expect(Array.isArray(body)).toBe(false);
  expect(body).toEqual({ accountId: "account_bank", count: 2 });
});
