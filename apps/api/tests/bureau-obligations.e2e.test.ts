import { mkdir, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { expect, test } from "vitest";
import { createTestHarness } from "wrangler";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bureau from "@open-erp/contracts/bureau-obligations";
import * as Commerce from "@open-erp/contracts/commerce";
import {
  apiDirectory,
  decoded,
  environment,
  evidence,
  failure,
  execute,
  fixture,
  journal,
  key,
  post,
  prepare,
  persisted,
  request,
} from "./support/fixtures";

// Failure contract: a production Worker refuses clock injection; malformed instants fail;
// a pinned E2E request reports retained revision age, not worker or database wall time.
// Native and Worker harnesses must agree on the same request-scoped clock; the
// production Worker and production Bun entrypoints must refuse clock headers.
// Failure cases for self-host: missing real web assets prevents a valid server;
// production Bun accepts the pinned header, changes retained facts, serves a
// different book, or leaves its child process alive after the assertion.
test("native synthetic browser API pins bureau time without changing stored obligations", async () => {
  const book = await fixture();
  const objectDirectory = join(environment().scratch, "native-clock-objects");
  await mkdir(objectDirectory, { mode: 0o700 });
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No native test port");

  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );

  const native = spawn("bun", ["scripts/native-browser-api.ts"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: environment().runtimeUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BETTER_AUTH_URL: origin,
      OPENERP_OBJECT_DIRECTORY: objectDirectory,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = createInterface({ input: native.stdout });
  let output = "";
  native.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  try {
    const startup = new Promise<string>((resolve, reject) => {
      native.once("error", reject);
      native.once("exit", () => reject(new Error(`Native API exited: ${output}`)));
      lines.on("line", (line) => {
        if (line.startsWith('{"nativeApi":true,')) resolve(JSON.parse(line).url as string);
      });
    });

    const url = await startup;
    const pin = "2026-10-02T06:54:00.000Z";

    const response = await fetch(`${url}${book.path}/bureau-obligations`, {
      headers: { authorization: `Bearer ${book.token}`, "x-openerp-test-now": pin },
    });

    const obligations = await decoded(response, Bureau.BureauObligations);

    expect(obligations.checkedAt).toBe(pin);
    await writeFile(
      join(environment().artifacts, "native-clock.json"),
      JSON.stringify({ checkedAt: obligations.checkedAt, coverage: obligations.coverage }, null, 2),
    );
  } finally {
    lines.close();

    if (native.pid && native.exitCode === null) {
      const exited = once(native, "exit");
      process.kill(-native.pid, "SIGTERM");
      await exited;
    }
  }
});

test("production Bun self-host refuses client-supplied time over real built web assets", async () => {
  await access(resolve(apiDirectory, "../web/dist/client/_shell.html"));

  const book = await fixture();
  await execute(book, await prepare(book));
  const before = await persisted(book);
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();

  if (!address || typeof address === "string") throw new Error("No production Bun test port");

  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );

  const production = spawn("bun", ["--no-env-file", "scripts/self-host.ts"], {
    cwd: apiDirectory,
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: environment().runtimeUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      OPENERP_PUBLIC_URL: origin,
      PORT: String(address.port),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = createInterface({ input: production.stdout });
  let output = "";
  production.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      production.once("error", reject);
      production.once("exit", () => reject(new Error(`Production Bun exited: ${output}`)));
      lines.on("line", (line) => {
        if (line.startsWith("Drastic self-host listening on ")) resolve();
      });
    });

    const url = `${origin}${book.path}/bureau-obligations`;
    const headers = { authorization: `Bearer ${book.token}` };
    const baseline = await decoded(await fetch(url, { headers }), Bureau.BureauObligations);

    const rejected = await fetch(url, {
      headers: { ...headers, "x-openerp-test-now": "2026-10-02T06:54:00.000Z" },
    });

    await failure(rejected, 403, "Forbidden");

    const after = await decoded(await fetch(url, { headers }), Bureau.BureauObligations);

    expect(after.items).toEqual(baseline.items);
    expect(after.coverage).toBe(baseline.coverage);
    expect(await persisted(book)).toEqual(before);

    await writeFile(
      join(environment().artifacts, "production-bun-clock-refusal.json"),
      JSON.stringify(
        {
          mode: "production-bun-self-host",
          status: rejected.status,
          requestId: rejected.headers.get("x-request-id"),
          unchangedItems: after.items.length,
          postingBefore: before,
          postingAfter: await persisted(book),
          coverage: after.coverage,
          webAssets: "real_build",
        },
        null,
        2,
      ),
    );
  } finally {
    lines.close();

    if (production.pid && production.exitCode === null) {
      const exited = once(production, "exit");
      process.kill(-production.pid, "SIGTERM");
      await exited;
    }
  }
});

test("production Worker refuses client-supplied time with a real PostgreSQL binding", async () => {
  const book = await fixture();

  const worker = createTestHarness({
    root: apiDirectory,
    workers: [
      {
        configPath: "wrangler.jsonc",
        secrets: { DATABASE_URL: environment().runtimeUrl, OPENERP_E2E_CLOCK: "enabled" },
      },
    ],
  });

  try {
    const listening = await worker.listen();

    const response = await fetch(`${listening.url.origin}${book.path}/bureau-obligations`, {
      headers: {
        authorization: `Bearer ${book.token}`,
        "x-openerp-test-now": "2026-10-02T06:54:00.000Z",
      },
    });

    await failure(response, 403, "Forbidden");
    await writeFile(
      join(environment().artifacts, "production-clock-refusal.json"),
      JSON.stringify(
        {
          mode: "production-entrypoint",
          status: response.status,
          requestId: response.headers.get("x-request-id"),
        },
        null,
        2,
      ),
    );
  } finally {
    await worker.close();
  }
});

test("bureau obligations read canonical stored residual once with two retained sources and partial coverage", async () => {
  const book = await fixture([{ id: "account_revenue", code: "4000", name: "Synthetic cost" }]);
  const source = await evidence(book);

  const revisionSource = await post(
    book,
    "/evidence",
    {
      title: "Revised synthetic obligation",
      content: "Independent synthetic revised due date",
      mediaType: "text/plain",
      origin: "Vitest E2E fixture",
    },
    Accounting.Evidence,
  );

  const party = await post(
    book,
    "/commerce/counterparties",
    {
      kind: "synthetic_counterparty_v1",
      externalKey: key(),
      role: "supplier",
      displayName: "Synthetic creditor",
      evidenceId: source.id,
      reason: "Synthetic creditor",
    },
    Commerce.CounterpartyRevision,
  );

  const plan = await post(
    book,
    "/change-sets",
    {
      ...journal(source.id, "12345"),
      postingDate: "2026-01-02",
      lines: [
        {
          accountId: "account_revenue",
          debitMinor: "12345",
          creditMinor: "0",
          description: "Synthetic cost",
        },
        {
          accountId: "account_clearing",
          debitMinor: "0",
          creditMinor: "12345",
          description: "Payable",
        },
      ],
    },
    Accounting.ChangeSet,
  );

  const posted = await execute(book, plan);

  const line = plan.groups[0]?.actions[0]?.lines.find(
    (entry) => entry.accountId === "account_clearing",
  );

  if (!line) throw new Error("Missing payable line");

  const invoice = await post(
    book,
    "/commerce/invoices",
    {
      kind: "synthetic_invoice_v1",
      direction: "supplier",
      counterpartyId: party.id,
      counterpartyRevision: party.revision,
      documentNumber: key(),
      issuedOn: "2026-01-02",
      dueOn: "2026-01-31",
      currency: "SEK",
      amountMinor: "12345",
      controlAccountId: "account_clearing",
      recognitionVoucherId: posted.voucherId,
      recognitionLineId: line.lineId,
      evidenceId: source.id,
      description: "Synthetic obligation",
    },
    Commerce.Invoice,
  );

  await post(
    book,
    `/commerce/invoices/${invoice.id}/revisions`,
    {
      expectedRevision: invoice.currentRevision.revision,
      dueOn: "2026-02-28",
      description: "Revised synthetic due date",
      evidenceId: revisionSource.id,
      reason: "Retained second source for the same obligation",
    },
    Commerce.Invoice,
  );

  const baseline = await decoded(
    await request(book, "/bureau-obligations"),
    Bureau.BureauObligations,
  );

  const original = baseline.items.find((entry) => entry.obligationId === invoice.id);

  expect(original?.freshness).toBe("current");
  expect(original?.outstandingMinor).toBe("12345");
  expect(original?.dueOn).toBe("2026-02-28");
  expect(original?.sources.map((source) => source.evidenceId).sort()).toEqual(
    [source.id, revisionSource.id].sort(),
  );

  const stockholmInstant = "2026-10-02T06:54:00.000Z"; // 08:54 Europe/Stockholm

  const pinned = await decoded(
    await request(book, "/bureau-obligations", {
      headers: { "x-openerp-test-now": stockholmInstant },
    }),
    Bureau.BureauObligations,
  );

  expect(pinned.checkedAt).toBe(stockholmInstant);

  const laterInstant = new Date(Date.parse(baseline.checkedAt) + 48 * 60 * 60 * 1000).toISOString();

  const stale = await decoded(
    await request(book, "/bureau-obligations", {
      headers: { "x-openerp-test-now": laterInstant },
    }),
    Bureau.BureauObligations,
  );

  const item = stale.items.find((entry) => entry.obligationId === invoice.id);

  expect(stale.checkedAt).toBe(laterInstant);
  expect(stale.coverage).toBe("partial");
  expect(item?.freshness).toBe("stale");
  expect(item).toMatchObject({
    obligationId: original?.obligationId,
    recordedAt: original?.recordedAt,
    outstandingMinor: original?.outstandingMinor,
    dueOn: original?.dueOn,
    sources: original?.sources,
  });
  expect(stale.items.filter((entry) => entry.obligationId === invoice.id)).toHaveLength(1);

  await failure(
    await request(book, "/bureau-obligations", {
      headers: { "x-openerp-test-now": "not-an-instant" },
    }),
    400,
    "InvalidRequest",
  );
  await writeFile(
    join(environment().artifacts, "bureau-obligations.json"),
    JSON.stringify({ scope: book.bookId, baseline, pinned, stale }, null, 2),
  );
});
