import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Setup from "@open-erp/contracts/company-setup";
import { expect, test } from "vitest";
import {
  createSession,
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  post,
  request,
  type BookFixture,
} from "./support/fixtures";

const NativeLedgerResponse = Schema.Struct({
  scope: Accounting.Scope,
  fiscalYear: Schema.Struct({
    id: Accounting.Identifier,
    startsOn: Accounting.CalendarDate,
    endsOn: Accounting.CalendarDate,
  }),
  periods: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      startsOn: Accounting.CalendarDate,
      endsOn: Accounting.CalendarDate,
    }),
  ),
  accounts: Schema.Array(
    Schema.Struct({ id: Accounting.Identifier, code: Schema.String, name: Schema.String }),
  ),
  setupRevision: Schema.Int,
});

const initial = {
  expectedRevision: 1,
  startsOn: "2025-05-17",
  endsOn: "2026-04-30",
  accounts: [
    { code: "1930", name: "Synthetic native bank" },
    { code: "2999", name: "Synthetic native clearing" },
  ],
};

const path = "/company-setup/native-ledger";

async function save(name: string, observed: unknown) {
  await writeFile(
    join(environment().artifacts, `company-ledger-setup-${name}.json`),
    JSON.stringify(observed, null, 2),
  );
}

async function company() {
  const identity = await fixture();
  const session = await createSession(identity);

  const setup = await post(
    { ...identity, token: session.token, path: "/api/v1" },
    "/companies",
    { name: "Synthetic initial ledger company" },
    Setup.CompanySetup,
  );

  const book = {
    ...identity,
    ...setup.scope,
    token: session.token,
    path: `/api/v1/entities/${setup.scope.entityId}/books/${setup.scope.bookId}`,
  };

  return { book, identity, setup };
}

async function state(book: BookFixture) {
  const admin = await database();

  try {
    const result = await admin.query(
      `select b.profile,b.currency,b.authority,b.committed_sequence::text as sequence,
       s.revision,s.details,
       (select count(*)::int from openerp.accounts where book_id=b.id) as accounts,
       (select count(*)::int from openerp.fiscal_years where book_id=b.id) as years,
       (select count(*)::int from openerp.periods where book_id=b.id) as periods,
       (select count(*)::int from openerp.vouchers where book_id=b.id) as vouchers,
       (select count(*)::int from openerp.approvals where book_id=b.id) as approvals,
       (select count(*)::int from openerp.approval_consumptions where book_id=b.id) as consumptions,
       (select count(*)::int from openerp.company_activations where book_id=b.id) as activations,
       (select count(*)::int from openerp.historical_bases where book_id=b.id) as history,
       (select count(*)::int from openerp.financial_opening_sets where book_id=b.id) as openings,
       (select count(*)::int from openerp.company_setup_commands where book_id=b.id) as commands
       from openerp.books b left join openerp.company_setups s on s.book_id=b.id where b.id=$1`,
      [book.bookId],
    );

    return result.rows[0];
  } finally {
    await admin.end();
  }
}

async function refused(
  book: BookFixture,
  input: unknown,
  status: number,
  code: typeof Accounting.FailureCode.Type,
  commandKey = key(),
) {
  const response = await request(book, path, {
    method: "POST",
    headers: { "idempotency-key": commandKey },
    body: JSON.stringify(input),
  });

  const body = await response.clone().text();

  await failure(response, status, code);

  return { status: response.status, body };
}

test("human native ledger initialization derives monthly periods and retains exact replay without financial effects", async () => {
  const { book, setup } = await company();
  const before = await state(book);
  const commandKey = key();

  const prepare = () =>
    request(book, path, {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(initial),
    });

  const configured = await decoded(await prepare(), NativeLedgerResponse);

  expect(configured.scope).toEqual(setup.scope);
  expect(configured.setupRevision).toBe(setup.revision);
  expect(configured.fiscalYear).toMatchObject({
    startsOn: initial.startsOn,
    endsOn: initial.endsOn,
  });
  expect(configured.accounts.map(({ code, name }) => ({ code, name }))).toEqual(initial.accounts);
  expect(configured.periods.map(({ startsOn, endsOn }) => ({ startsOn, endsOn }))).toEqual([
    { startsOn: "2025-05-17", endsOn: "2025-05-31" },
    { startsOn: "2025-06-01", endsOn: "2025-06-30" },
    { startsOn: "2025-07-01", endsOn: "2025-07-31" },
    { startsOn: "2025-08-01", endsOn: "2025-08-31" },
    { startsOn: "2025-09-01", endsOn: "2025-09-30" },
    { startsOn: "2025-10-01", endsOn: "2025-10-31" },
    { startsOn: "2025-11-01", endsOn: "2025-11-30" },
    { startsOn: "2025-12-01", endsOn: "2025-12-31" },
    { startsOn: "2026-01-01", endsOn: "2026-01-31" },
    { startsOn: "2026-02-01", endsOn: "2026-02-28" },
    { startsOn: "2026-03-01", endsOn: "2026-03-31" },
    { startsOn: "2026-04-01", endsOn: "2026-04-30" },
  ]);
  expect(new Set(configured.accounts.map((account) => account.id)).size).toBe(2);
  expect(new Set(configured.periods.map((period) => period.id)).size).toBe(12);

  const after = await state(book);

  expect(after).toEqual({ ...before, accounts: 2, years: 1, periods: 12, commands: 2 });

  const available = await decoded(await request(book, "/setup"), Accounting.BookSetup);

  expect([...available.accounts].sort((a, b) => a.code.localeCompare(b.code))).toEqual(
    configured.accounts.map((account) => ({ ...account, active: true })),
  );
  expect([...available.periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn))).toEqual(
    configured.periods.map((period) => ({ ...period, locked: false })),
  );

  await post(
    book,
    "/company-setup",
    {
      expectedRevision: setup.revision,
      details: { ...setup.details, name: "Synthetic renamed company" },
    },
    Setup.CompanySetup,
  );

  const beforeReplay = await state(book);
  const recovered = await decoded(await prepare(), NativeLedgerResponse);

  expect(recovered).toEqual(configured);
  expect(await state(book)).toEqual(beforeReplay);

  const changed = await refused(
    book,
    { ...initial, endsOn: "2026-05-31" },
    409,
    "IdempotencyConflict",
    commandKey,
  );

  const repeated = await refused(
    book,
    { ...initial, expectedRevision: 2 },
    422,
    "UnsupportedProfile",
  );

  expect(await state(book)).toEqual(beforeReplay);
  await save("initial-replay", {
    initial,
    before,
    configured,
    available,
    after,
    recovered,
    changed,
    repeated,
    beforeReplay,
    final: await state(book),
  });
});

test.each([
  { startsOn: "2024-02-15", endsOn: "2024-02-29", expectedPeriods: 1 },
  { startsOn: "2025-01-01", endsOn: "2026-06-30", expectedPeriods: 18 },
])(
  "native calendar accepts explicit leap-day and eighteen-month boundaries $startsOn",
  async (calendar) => {
    const { book } = await company();
    const before = await state(book);

    const configured = await post(
      book,
      path,
      { ...initial, startsOn: calendar.startsOn, endsOn: calendar.endsOn },
      NativeLedgerResponse,
    );

    expect(configured.periods).toHaveLength(calendar.expectedPeriods);
    expect(configured.periods[0]?.startsOn).toBe(calendar.startsOn);
    expect(configured.periods.at(-1)?.endsOn).toBe(calendar.endsOn);
    expect(await state(book)).toEqual({
      ...before,
      accounts: 2,
      years: 1,
      periods: calendar.expectedPeriods,
      commands: 2,
    });
    await save(`calendar-${calendar.startsOn}`, { calendar, configured, final: await state(book) });
  },
);

const failureContract = [
  {
    name: "stale_revision",
    input: { ...initial, expectedRevision: 0 },
    status: 409,
    code: "StaleDependency",
  },
  {
    name: "impossible_date",
    input: { ...initial, startsOn: "2025-02-29" },
    status: 400,
    code: "InvalidRequest",
  },
  {
    name: "reversed_dates",
    input: { ...initial, startsOn: "2026-05-01" },
    status: 422,
    code: "InvalidJournal",
  },
  {
    name: "non_month_end",
    input: { ...initial, endsOn: "2026-04-29" },
    status: 422,
    code: "InvalidJournal",
  },
  {
    name: "over_eighteen_months",
    input: { ...initial, endsOn: "2026-11-30" },
    status: 422,
    code: "InvalidJournal",
  },
  {
    name: "duplicate_codes",
    input: { ...initial, accounts: [initial.accounts[0], initial.accounts[0]] },
    status: 422,
    code: "InvalidJournal",
  },
  {
    name: "empty_name",
    input: { ...initial, accounts: [{ code: "1930", name: " " }] },
    status: 400,
    code: "InvalidRequest",
  },
  {
    name: "invalid_code",
    input: { ...initial, accounts: [{ code: "193", name: "Synthetic account" }] },
    status: 400,
    code: "InvalidRequest",
  },
  {
    name: "empty_accounts",
    input: { ...initial, accounts: [] },
    status: 400,
    code: "InvalidRequest",
  },
  {
    name: "client_identity",
    input: {
      ...initial,
      accounts: [{ id: "client_account", code: "1930", name: "Synthetic account" }],
    },
    status: 400,
    code: "InvalidRequest",
  },
] satisfies ReadonlyArray<{
  name: string;
  input: unknown;
  status: number;
  code: typeof Accounting.FailureCode.Type;
}>;

test.each(failureContract)(
  "native ledger refuses $name with no configuration or financial effects",
  async (scenario) => {
    const { book } = await company();
    const before = await state(book);
    const refusal = await refused(book, scenario.input, scenario.status, scenario.code);

    expect(await state(book)).toEqual(before);
    await save(scenario.name, { refusal, before, after: await state(book) });
  },
);

test.each(["api_credential", "agent", "outsider", "wrong_entity"] as const)(
  "native initialization refuses %s authority without effects",
  async (scenario) => {
    const { book, identity } = await company();
    const before = await state(book);
    let caller = book;

    if (scenario === "api_credential") caller = { ...book, token: identity.token };

    if (scenario === "outsider") {
      const outsider = await fixture();
      const session = await createSession(outsider);

      caller = { ...book, token: session.token };
    }

    if (scenario === "agent") {
      const admin = await database();

      try {
        await admin.query(
          "update openerp.memberships set role='agent' where book_id=$1 and actor_id=$2",
          [book.bookId, book.actorId],
        );
      } finally {
        await admin.end();
      }
    }

    if (scenario === "wrong_entity")
      caller = { ...book, path: `/api/v1/entities/${identity.entityId}/books/${book.bookId}` };

    const refusal = await refused(caller, initial, 403, "Forbidden");

    expect(await state(book)).toEqual(before);
    await save(scenario, { refusal, before, after: await state(book) });
  },
);

test.each(["synthetic", "existing_account", "existing_year"] as const)(
  "native initialization refuses %s books without altering existing records",
  async (scenario) => {
    const { book } = await company();
    const admin = await database();

    try {
      if (scenario === "synthetic")
        await admin.query("update openerp.books set profile='synthetic-core-v1' where id=$1", [
          book.bookId,
        ]);

      if (scenario === "existing_account")
        await admin.query(
          "insert into openerp.accounts(book_id,id,code,name) values($1,'existing_account','1999','Synthetic existing account')",
          [book.bookId],
        );

      if (scenario === "existing_year")
        await admin.query(
          "insert into openerp.fiscal_years(book_id,id,starts_on,ends_on) values($1,'existing_year','2025-01-01','2025-12-31')",
          [book.bookId],
        );
    } finally {
      await admin.end();
    }

    const before = await state(book);
    const refusal = await refused(book, initial, 422, "UnsupportedProfile");

    expect(await state(book)).toEqual(before);
    await save(scenario, { refusal, before, after: await state(book) });
  },
);
