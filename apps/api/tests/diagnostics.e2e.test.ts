import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestHarness, type TestHarnessOptions } from "wrangler";
import { apiDirectory, database, decoded, environment, fixture, prepare } from "./support/fixtures";

const server = createTestHarness();

let baseUrl: string;

function options(databaseUrl: string): TestHarnessOptions {
  return {
    root: apiDirectory,
    workers: [
      {
        configPath: "tests/support/diagnostics.wrangler.jsonc",
        secrets: { DATABASE_URL: databaseUrl },
      },
    ],
  };
}

beforeAll(async () => {
  await server.update(options(environment().runtimeUrl));
  baseUrl = (await server.listen()).url.origin;
});

afterAll(async () => {
  try {
    await server.close();
  } finally {
    await writeFile(
      join(environment().artifacts, "diagnostics-worker.json"),
      JSON.stringify(server.getLogs(), null, 2),
    );
  }
});

async function diagnostic(response: Response) {
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

  const matching = () =>
    server.getLogs().filter((log) => requestId !== null && log.message.includes(requestId));

  await expect.poll(() => matching().length).toBe(1);
  expect(matching().map((entry) => entry.level)).toEqual(["error"]);

  return JSON.stringify(matching());
}

test("the real Worker console reaches the harness", async () => {
  const response = await fetch(`${baseUrl}/__test/console`);
  expect(await response.text()).toBe("captured");
  await expect
    .poll(() =>
      server.getLogs().some((log) => log.message.includes("E2E Worker console capture probe")),
    )
    .toBe(true);
});

test("retained schema failures keep the field and type, not the input, and correlate assertions", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const admin = await database();
  const secret = "synthetic-private-schema-input";
  const corruptId = "diagnostic_bad_plan";

  try {
    await admin.query(
      `INSERT INTO openerp.change_sets(book_id, id, plan, digest, created_by)
      SELECT book_id, $3, jsonb_set(plan, '{version}', to_jsonb($4::text)), digest, created_by
      FROM openerp.change_sets WHERE book_id = $1 AND id = $2`,
      [book.bookId, plan.id, corruptId, secret],
    );
  } finally {
    await admin.end();
  }

  const response = await fetch(
    `${baseUrl}${book.path}/change-sets/${corruptId}?private=${secret}`,
    {
      headers: { authorization: `Bearer ${book.token}`, "x-request-id": secret },
    },
  );

  expect(response.status).toBe(500);
  expect(await response.clone().json()).toEqual({
    _tag: "AccountingError",
    code: "InternalError",
    message: "The accounting service could not complete this request.",
  });
  const log = await diagnostic(response);
  expect(log).toContain("SchemaError");
  expect(log).toContain("version");
  expect(log).toContain("Expected literal 1");
  expect(log).toContain("GET");
  expect(log).toContain(`/change-sets/${corruptId}`);
  expect(log).not.toContain(secret);
  expect(log).not.toContain(book.token);
  await expect(decoded(response, Accounting.ChangeSet)).rejects.toThrow(
    response.headers.get("x-request-id") ?? "missing-request-id",
  );
});

test("database faults retain SQLSTATE and constraint without SQL values and expected refusals stay quiet", async () => {
  const book = await fixture();
  const admin = await database();
  const secret = "synthetic-private-database-detail";
  let response: Response;

  try {
    await admin.query(`CREATE FUNCTION openerp.e2e_diagnostic_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.book_id = '${book.bookId}' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'e2e_diagnostic_constraint',
          MESSAGE = '${secret}', DETAIL = '${secret}';
      END IF; RETURN NEW; END $$`);
    await admin.query(
      "CREATE TRIGGER e2e_diagnostic_fault BEFORE INSERT ON openerp.evidence FOR EACH ROW EXECUTE FUNCTION openerp.e2e_diagnostic_fault()",
    );
    response = await fetch(`${baseUrl}${book.path}/evidence`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${book.token}`,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        title: secret,
        content: secret,
        mediaType: "text/plain",
        origin: "E2E diagnostics",
      }),
    });
  } finally {
    await admin.query("DROP TRIGGER IF EXISTS e2e_diagnostic_fault ON openerp.evidence");
    await admin.query("DROP FUNCTION IF EXISTS openerp.e2e_diagnostic_fault()");
    await admin.end();
  }

  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain(secret);
  const log = await diagnostic(response);
  expect(log).toContain("23514");
  expect(log).toContain("e2e_diagnostic_constraint");
  expect(log).toContain("POST");
  expect(log).not.toContain(secret);
  expect(log).not.toContain(book.token);

  const refused = await fetch(`${baseUrl}${book.path}/change-sets/missing`);
  expect(refused.status).toBe(401);
  await refused.text();
  expect(
    server
      .getLogs()
      .filter((entry) =>
        entry.message.includes(refused.headers.get("x-request-id") ?? "missing-request-id"),
      ),
  ).toEqual([]);
});

test("connection failures produce a safe correlated 503", async () => {
  const book = await fixture();
  const unavailable = new URL(environment().runtimeUrl);
  unavailable.password = "synthetic-wrong-password";
  await server.update(options(unavailable.href));

  try {
    const response = await fetch(`${baseUrl}${book.path}/change-sets/missing`, {
      headers: { authorization: `Bearer ${book.token}` },
    });

    expect(response.status, await response.clone().text()).toBe(503);
    expect(await response.text()).not.toContain(unavailable.password);
    const log = await diagnostic(response);
    expect(log).toContain("AuthenticationError");
    expect(log).toContain("28P01");
    expect(log).not.toContain(unavailable.password);
    expect(log).not.toContain(book.token);
  } finally {
    await server.update(options(environment().runtimeUrl));
  }
});
