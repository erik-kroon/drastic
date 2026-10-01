import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { bookSetup } from "../src/application/posting";
import { databaseLayer } from "../src/db/connection";
import { RequestEnvironment } from "../src/runtime/environment";
import { database, decoded, environment, fixture, request } from "./support/fixtures";

const datedSetup = Schema.Struct({ today: Accounting.AccountingDate });

test("DF-07 setup serves the server's Stockholm date through HTTP", async () => {
  const book = await fixture();
  const admin = await database();

  try {
    const expected = await admin.query(
      "select (clock_timestamp() at time zone 'Europe/Stockholm')::date::text as today",
    );

    const actual = await decoded(await request(book, "/setup"), datedSetup);

    expect(actual.today).toBe(expected.rows[0]?.today);

    const mcp = await decoded(
      await fetch(`${environment().baseUrl}/api/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${book.agentToken}`,
          "content-type": "application/json",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "book_get_setup",
            arguments: { scope: { entityId: book.entityId, bookId: book.bookId } },
          },
        }),
      }),
      Schema.Struct({
        result: Schema.Struct({ structuredContent: Schema.Struct({ result: datedSetup }) }),
      }),
    );

    expect(mcp.result.structuredContent.result.today).toBe(actual.today);
    await writeFile(
      join(environment().artifacts, "df-07-setup-date.json"),
      JSON.stringify({ expected: expected.rows, actual }, null, 2),
    );
  } finally {
    await admin.end();
  }
});

test.each([
  ["2026-12-31T22:59:00Z", "2026-12-31"],
  ["2026-12-31T23:00:00Z", "2027-01-01"],
  ["2026-12-31T23:30:00Z", "2027-01-01"],
  ["2026-06-30T22:30:00Z", "2026-07-01"],
  ["2026-03-29T01:30:00Z", "2026-03-29"],
  ["2026-10-25T01:30:00Z", "2026-10-25"],
])("DF-07 setup reads its injectable server clock at %s", async (instant, expected) => {
  const book = await fixture();
  const milliseconds = Date.parse(instant);

  const setup = await Effect.runPromise(
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;

      return yield* bookSetup(book.token, {
        scope: { entityId: book.entityId, bookId: book.bookId },
      }).pipe(
        Effect.provideService(Clock.Clock, {
          currentTimeMillis: Effect.succeed(milliseconds),
          currentTimeMillisUnsafe: () => milliseconds,
          currentTimeNanos: Effect.succeed(BigInt(milliseconds) * 1_000_000n),
          currentTimeNanosUnsafe: () => BigInt(milliseconds) * 1_000_000n,
          monotonicTimeNanos: clock.monotonicTimeNanos,
          monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
          sleep: (duration) => clock.sleep(duration),
        }),
      );
    }).pipe(
      Effect.provide(
        databaseLayer({
          connectionString: Redacted.make(environment().runtimeUrl),
          applicationName: "e2e-business-date",
          connectTimeoutMs: 5000,
          statementTimeoutMs: 5000,
        }),
      ),
      Effect.provideService(RequestEnvironment, {
        bindings: { DATABASE_URL: environment().runtimeUrl },
        url: new URL(environment().baseUrl),
      }),
    ),
  );

  const actual = Schema.decodeSync(datedSetup)(setup);

  expect(actual.today).toBe(expected);
  await writeFile(
    join(environment().artifacts, `df-07-clock-${expected}.json`),
    JSON.stringify({ instant, expected, actual }, null, 2),
  );
});
