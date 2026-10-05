import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Cash from "@open-erp/contracts/cash-forecast";
import { cashBasisWorld, qualifiedCashBasisInput } from "./support/cash-basis";
import {
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  key,
  journal,
  post,
  request,
} from "./support/fixtures";

function calendarOffset(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

async function recognizedInvoice(
  context: Awaited<ReturnType<typeof cashBasisWorld>>,
  direction: "customer" | "supplier",
  amountMinor: string,
  dueOn: string,
) {
  const source = await evidence(context.book);

  const party = await post(
    context.book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: direction,
      displayName: `Independent forecast ${direction}`,
      evidenceId: source.id,
      reason: "Synthetic retained obligation, not company data",
    },
    Commerce.CounterpartyRevision,
  );

  const controlAccountId = direction === "customer" ? "account_ar" : "account_clearing";
  const funding = journal(source.id, amountMinor);

  const plan = await post(
    context.book,
    "/change-sets",
    {
      ...funding,
      postingDate: context.today,
      lines:
        direction === "customer"
          ? [
              {
                accountId: controlAccountId,
                debitMinor: amountMinor,
                creditMinor: "0",
                description: "Receivable",
              },
              {
                accountId: "account_revenue",
                debitMinor: "0",
                creditMinor: amountMinor,
                description: "Revenue",
              },
            ]
          : [
              {
                accountId: "account_revenue",
                debitMinor: amountMinor,
                creditMinor: "0",
                description: "Synthetic cost",
              },
              {
                accountId: controlAccountId,
                debitMinor: "0",
                creditMinor: amountMinor,
                description: "Payable",
              },
            ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(context.book, plan);

  const control = plan.groups[0]?.actions[0]?.lines.find(
    (line) => line.accountId === controlAccountId,
  );

  if (!control) throw new Error("Forecast invoice requires a native retained recognition line");

  return post(
    context.book,
    "/commerce/invoices",
    {
      kind: "synthetic_invoice_v1",
      direction,
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: key(),
      issuedOn: dueOn < context.today ? `${dueOn.slice(0, 8)}01` : context.today,
      dueOn,
      currency: "SEK",
      amountMinor,
      controlAccountId,
      recognitionVoucherId: posted.voucherId,
      recognitionLineId: control.lineId,
      evidenceId: source.id,
      description: "Independently specified forecast obligation",
    },
    Commerce.Invoice,
  );
}

async function qualifiedBasis(context: Awaited<ReturnType<typeof cashBasisWorld>>) {
  const account = context.input.accounts.find(
    (selection) => selection.accountId === "account_bank",
  );

  if (!account) throw new Error("Literal forecast opening needs the100000 bank witness");

  const selection = await qualifiedCashBasisInput(context.book, context.today, [
    {
      accountId: account.accountId,
      reconciliationId: account.reconciliationId,
    },
  ]);

  return post(context.book, "/cash-bases", selection.input, Cash.CashBasis);
}

const Minimum = Schema.Struct({ amountMinor: Schema.String, on: Schema.String });

const Forecast = Schema.Struct({
  id: Schema.String,
  basisId: Schema.String,
  basisDigest: Schema.String,
  calculatorVersion: Schema.String,
  asOf: Schema.String,
  horizonDays: Schema.Int,
  endsOn: Schema.String,
  label: Schema.Literal("known_items"),
  companyCoverage: Schema.Literal("incomplete"),
  result: Schema.Struct({
    status: Schema.Literal("available"),
    openingMinor: Schema.String,
    closingMinor: Schema.String,
    baseline: Schema.Struct({ minimum: Minimum, headroomMinor: Schema.String }),
    conservative: Schema.Struct({ minimum: Minimum, headroomMinor: Schema.String }),
    days: Schema.Array(
      Schema.Struct({
        on: Schema.String,
        inflowMinor: Schema.String,
        outflowMinor: Schema.String,
        closingMinor: Schema.String,
        conservativeLowMinor: Schema.String,
      }),
    ),
  }),
  contributions: Schema.Array(
    Schema.Struct({
      invoiceId: Schema.String,
      amountMinor: Schema.NullOr(Schema.String),
      dueOn: Schema.String,
      expectedOn: Schema.NullOr(Schema.String),
      scheduledOn: Schema.NullOr(Schema.String),
      disposition: Schema.String,
      reason: Schema.String,
    }),
  ),
  digest: Schema.String,
});

async function scenario(
  context: Awaited<ReturnType<typeof cashBasisWorld>>,
  basis: typeof Cash.CashBasis.Type,
  horizonDays = 30,
  bufferMinor = "90000",
) {
  const response = await request(context.book, "/cash-forecasts", {
    method: "POST",
    headers: { "idempotency-key": key() },
    body: JSON.stringify({
      basisId: basis.id,
      basisDigest: basis.digest,
      horizonDays,
      bufferMinor,
      expectedDates: [],
    }),
  });

  await writeFile(
    join(environment().artifacts, "cash-forecast-capture-response.json"),
    JSON.stringify(
      {
        status: response.status,
        body: await response.clone().text(),
        basisId: basis.id,
        basisDigest: basis.digest,
      },
      null,
      2,
    ),
  );
  expect(response.status).toBe(200);

  return decoded(response, Forecast);
}

test("Cash history discovers immutable scoped records across bounded continuation pages", async () => {
  const context = await cashBasisWorld();
  const basis = await post(context.book, "/cash-bases", context.input, Cash.CashBasis);
  const retained = [];

  for (let index = 0; index < 51; index++) retained.push(await scenario(context, basis, 30, "0"));

  const before = await request(context.book, `/cash-forecasts/${retained[0]!.id}/export`);
  const original = await before.text();

  const first = await decoded(
    await request(context.book, "/cash-forecasts"),
    Cash.CashForecastPage,
  );

  expect(first.items).toHaveLength(50);
  expect(first.total).toBe(51);
  expect(first.next).not.toBeNull();

  const second = await decoded(
    await request(context.book, `/cash-forecasts?after=${first.next}`),
    Cash.CashForecastPage,
  );

  expect(second.items).toHaveLength(1);
  expect(second.next).toBeNull();
  expect(second.total).toBe(51);
  expect([...first.items, ...second.items].map((item) => item.id).sort()).toEqual(
    retained.map((item) => item.id).sort(),
  );
  const bases = await decoded(await request(context.book, "/cash-bases"), Cash.CashBasisPage);
  expect(bases.items.map((item) => item.id)).toEqual([basis.id]);
  expect(bases.total).toBe(1);
  expect(bases.items[0]?.openingMinor).toBe("150000");
  const other = await fixture();
  const empty = await decoded(await request(other, "/cash-forecasts"), Cash.CashForecastPage);
  expect(empty).toEqual({ items: [], next: null, total: 0 });
  await failure(await request(other, `/cash-forecasts?after=${first.next}`), 404, "NotFound");
  await failure(await request(context.book, "/cash-bases?after=missing_basis"), 404, "NotFound");
  expect(
    await (await request(context.book, `/cash-forecasts/${retained[0]!.id}/export`)).text(),
  ).toBe(original);
  await writeFile(
    join(environment().artifacts, "cash-history-pagination.json"),
    JSON.stringify({ first, second, bases, empty, immutableExportUnchanged: true }, null, 2),
  );
}, 180000);

test("P11 saves literal exact balances and immutable known-items exports from native retained obligations", async () => {
  const context = await cashBasisWorld();

  const supplier = await recognizedInvoice(
    context,
    "supplier",
    "30000",
    calendarOffset(context.today, 1),
  );

  const customer = await recognizedInvoice(
    context,
    "customer",
    "20000",
    calendarOffset(context.today, 2),
  );

  const basis = await qualifiedBasis(context);
  expect(basis.opening.totalMinor).toBe("100000");
  const before = await request(context.book, `/cash-bases/${basis.id}/export`);
  expect(before.status).toBe(200);
  const basisBytes = await before.text();
  const saved = await scenario(context, basis);
  expect(saved.result.openingMinor).toBe("100000");
  expect(saved.result.baseline.minimum).toEqual({
    amountMinor: "70000",
    on: calendarOffset(context.today, 1),
  });
  expect(saved.result.baseline.headroomMinor).toBe("-20000");
  expect(saved.result.closingMinor).toBe("90000");
  expect(saved.result.days).toHaveLength(30);
  expect(saved.endsOn).toBe(calendarOffset(context.today, 29));
  expect(saved.contributions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        invoiceId: supplier.id,
        amountMinor: "30000",
        dueOn: supplier.currentRevision.dueOn,
        disposition: "dated",
      }),
      expect.objectContaining({
        invoiceId: customer.id,
        amountMinor: "20000",
        dueOn: customer.currentRevision.dueOn,
        disposition: "dated",
      }),
    ]),
  );
  const exported = await request(context.book, `/cash-forecasts/${saved.id}/export`);
  expect(exported.status).toBe(200);
  const bytes = await exported.text();
  expect(Schema.decodeSync(Schema.fromJsonString(Forecast))(bytes)).toEqual(saved);
  const repeated = await request(context.book, `/cash-forecasts/${saved.id}/export`);
  expect(repeated.status).toBe(200);
  expect(await repeated.text()).toBe(bytes);
  const after = await request(context.book, `/cash-bases/${basis.id}/export`);
  expect(after.status).toBe(200);
  expect(await after.text()).toBe(basisBytes);
  await writeFile(
    join(environment().artifacts, "cash-forecast-literal-journey.json"),
    JSON.stringify(
      {
        openingMinor: "100000",
        supplierId: supplier.id,
        customerId: customer.id,
        saved,
        exportSha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: Buffer.byteLength(bytes),
      },
      null,
      2,
    ),
  );
}, 120000);

test("P11 distinguishes same-day closing from the conservative outflows-first minimum", async () => {
  const context = await cashBasisWorld();
  await recognizedInvoice(context, "supplier", "80000", context.today);
  await recognizedInvoice(context, "customer", "90000", context.today);
  const basis = await qualifiedBasis(context);
  const saved = await scenario(context, basis, 91, "0");
  expect(saved.result.baseline.minimum).toEqual({ amountMinor: "100000", on: context.today });
  expect(saved.result.conservative.minimum).toEqual({ amountMinor: "20000", on: context.today });
  expect(saved.result.closingMinor).toBe("110000");
  expect(saved.result.days[0]).toEqual({
    on: context.today,
    inflowMinor: "90000",
    outflowMinor: "80000",
    closingMinor: "110000",
    conservativeLowMinor: "20000",
  });
  expect(saved.result.days).toHaveLength(91);
  expect(saved.endsOn).toBe(calendarOffset(context.today, 90));
}, 120000);

test("P11 preserves overdue obligations outside the curve and includes opening in inflow-only minima", async () => {
  const context = await cashBasisWorld();
  const overdue = await recognizedInvoice(context, "supplier", "30000", context.yesterday);
  await recognizedInvoice(context, "customer", "20000", calendarOffset(context.today, 1));
  const basis = await qualifiedBasis(context);
  const saved = await scenario(context, basis, 90, "0");
  expect(saved.result.baseline.minimum).toEqual({ amountMinor: "100000", on: context.today });
  expect(saved.result.closingMinor).toBe("120000");
  expect(saved.contributions).toContainEqual(
    expect.objectContaining({
      invoiceId: overdue.id,
      dueOn: context.yesterday,
      scheduledOn: null,
      disposition: "undated",
    }),
  );
  expect(saved.result.days).toHaveLength(90);
  expect(saved.endsOn).toBe(calendarOffset(context.today, 89));
}, 120000);

test("P11 retains the last horizon day and preserves later and impossible source dates outside the curve", async () => {
  const context = await cashBasisWorld();

  const last = await recognizedInvoice(
    context,
    "supplier",
    "10000",
    calendarOffset(context.today, 29),
  );

  const later = await recognizedInvoice(
    context,
    "supplier",
    "20000",
    calendarOffset(context.today, 30),
  );

  const invalid = await recognizedInvoice(context, "supplier", "30000", "2026-02-31");
  const basis = await qualifiedBasis(context);
  const saved = await scenario(context, basis, 30, "0");
  expect(saved.result.closingMinor).toBe("90000");
  expect(saved.result.baseline.minimum).toEqual({
    amountMinor: "90000",
    on: calendarOffset(context.today, 29),
  });
  expect(saved.contributions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        invoiceId: last.id,
        scheduledOn: calendarOffset(context.today, 29),
        disposition: "dated",
      }),
      expect.objectContaining({
        invoiceId: later.id,
        dueOn: calendarOffset(context.today, 30),
        disposition: "outside_horizon",
      }),
      expect.objectContaining({
        invoiceId: invalid.id,
        dueOn: "2026-02-31",
        scheduledOn: null,
        disposition: "blocked",
        reason: "invalid_source_date",
      }),
    ]),
  );
}, 120000);

test("P11 preserves an unavailable opening rather than inventing zero balances", async () => {
  const context = await cashBasisWorld({ incomplete: true });
  const basis = await qualifiedBasis(context);
  expect(basis.opening.status).toBe("unavailable");
  expect(basis.opening.totalMinor).toBeNull();

  const response = await request(context.book, "/cash-forecasts", {
    method: "POST",
    body: JSON.stringify({
      basisId: basis.id,
      basisDigest: basis.digest,
      horizonDays: 30,
      bufferMinor: "0",
      expectedDates: [],
    }),
  });

  expect(response.status).toBe(200);

  const saved = await decoded(
    response,
    Schema.Struct({
      id: Schema.String,
      label: Schema.Literal("known_items"),
      companyCoverage: Schema.Literal("incomplete"),
      result: Schema.Struct({
        status: Schema.Literal("unavailable"),
        openingMinor: Schema.Null,
        closingMinor: Schema.Null,
        baseline: Schema.Null,
        conservative: Schema.Null,
        days: Schema.Array(Schema.Unknown),
      }),
    }),
  );

  expect(saved.result).toEqual({
    status: "unavailable",
    openingMinor: null,
    closingMinor: null,
    baseline: null,
    conservative: null,
    days: [],
  });
}, 120000);

test("P11 refuses supplied financial facts, invalid assumptions, scope substitution and revoked authority", async () => {
  const context = await cashBasisWorld();

  const invoice = await recognizedInvoice(
    context,
    "customer",
    "20000",
    calendarOffset(context.today, 1),
  );

  const basis = await qualifiedBasis(context);
  const review = await evidence(context.book);

  const input = {
    basisId: basis.id,
    basisDigest: basis.digest,
    horizonDays: 30,
    bufferMinor: "0",
    expectedDates: [],
  };

  for (const altered of [
    { ...input, openingMinor: "999999" },
    { ...input, amountMinor: "1" },
    { ...input, recordedCutoff: "2026-01-01T00:00:00Z" },
    { ...input, bufferMinor: "-1" },
    { ...input, horizonDays: 31 },
    {
      ...input,
      expectedDates: [
        {
          invoiceId: invoice.id,
          expectedOn: "2026-02-31",
          review: {
            evidenceId: review.id,
            sha256: review.sha256,
            reason: "Independent invalid expectation",
          },
        },
      ],
    },
  ]) {
    const response = await request(context.book, "/cash-forecasts", {
      method: "POST",
      body: JSON.stringify(altered),
    });

    expect(response.status).toBe(400);
  }

  await failure(
    await request(context.book, "/cash-forecasts", {
      method: "POST",
      body: JSON.stringify({ ...input, basisDigest: `sha256:${"0".repeat(64)}` }),
    }),
    409,
    "StaleDependency",
  );
  const other = await fixture();
  await failure(
    await request(other, "/cash-forecasts", { method: "POST", body: JSON.stringify(input) }),
    404,
    "NotFound",
  );
  const saved = await scenario(context, basis);
  const admin = await database();

  try {
    await admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
      context.book.bookId,
      context.book.actorId,
    ]);
  } finally {
    await admin.end();
  }

  await failure(await request(context.book, `/cash-forecasts/${saved.id}`), 403, "Forbidden");
  await failure(
    await request(context.book, `/cash-forecasts/${saved.id}/export`),
    403,
    "Forbidden",
  );
  await failure(
    await request(context.book, "/cash-forecasts", { method: "POST", body: JSON.stringify(input) }),
    403,
    "Forbidden",
  );
}, 120000);
