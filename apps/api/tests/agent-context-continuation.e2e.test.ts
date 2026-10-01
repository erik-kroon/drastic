import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createTestHarness } from "wrangler";
import { expect, test } from "vitest";
import {
  createSession,
  database,
  decoded,
  environment,
  evidence,
  execute,
  failure,
  fixture,
  journal,
  key,
  post,
  request,
} from "./support/fixtures";

const Capture = Schema.Struct({
  id: Accounting.Identifier,
  digest: Accounting.Digest,
  total: Accounting.MinorUnits,
});

const Progress = Schema.Struct({
  revision: Accounting.MinorUnits,
  position: Accounting.MinorUnits,
});

const Page = Schema.Struct({
  capture: Capture,
  items: Schema.Array(
    Schema.Struct({
      identity: Accounting.Identifier,
      digest: Accounting.Digest,
    }),
  ),
  offset: Accounting.MinorUnits,
  next: Schema.NullOr(Accounting.MinorUnits),
  pageDigest: Accounting.Digest,
  current: Schema.Boolean,
  progress: Progress,
});

test("retained context resumes through MCP after its serving Worker is stopped and replaced", async () => {
  const book = await fixture();
  const source = await evidence(book);

  for (let index = 0; index < 51; index++) {
    await post(book, "/change-sets", journal(source.id, "12500"), Accounting.ChangeSet);
  }

  const scope = { entityId: book.entityId, bookId: book.bookId };

  const makeWorker = () =>
    createTestHarness({
      root: resolve(import.meta.dirname, ".."),
      workers: [
        {
          configPath: "wrangler.jsonc",
          env: "e2e",
          secrets: { DATABASE_URL: environment().runtimeUrl },
        },
      ],
    });

  const first = makeWorker();
  const firstAddress = await first.listen();

  const call = async (origin: string, name: string, args: unknown) => {
    const response = await fetch(`${origin}/api/mcp`, {
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
        params: { name, arguments: args },
      }),
    });

    return await decoded(
      response,
      Schema.Struct({
        result: Schema.Struct({
          structuredContent: Schema.Struct({ result: Schema.Unknown }),
        }),
      }),
    );
  };

  let captureId = "";

  try {
    const captured = await call(firstAddress.url.origin, "workspace_capture_context", {
      scope,
      idempotencyKey: key(),
      input: { goal: "close_the_year", period: null },
    });

    const capture = Schema.decodeUnknownSync(Capture)(captured.result.structuredContent.result);

    captureId = capture.id;

    const response = await call(firstAddress.url.origin, "workspace_get_context_page", {
      scope,
      captureId,
    });

    const page = Schema.decodeUnknownSync(Page)(response.result.structuredContent.result);

    expect(page.items).toHaveLength(50);
    await call(firstAddress.url.origin, "workspace_advance_context", {
      scope,
      captureId,
      idempotencyKey: key(),
      input: { expectedRevision: "0", pageDigest: page.pageDigest },
    });
  } finally {
    await first.close();
  }

  const second = makeWorker();

  try {
    const address = await second.listen();

    const response = await call(address.url.origin, "workspace_get_context_page", {
      scope,
      captureId,
    });

    const resumed = Schema.decodeUnknownSync(Page)(response.result.structuredContent.result);

    expect(resumed.offset).toBe("50");
    expect(resumed.items).toHaveLength(1);
    expect(resumed.current).toBe(true);
    expect(resumed.progress.revision).toBe("1");
    await writeFile(
      join(environment().artifacts, "agent-context-worker-restart.json"),
      JSON.stringify({ firstWorkerClosed: true, replacementWorker: true, resumed }, null, 2),
    );
  } finally {
    await second.close();
  }
}, 60000);

test("durable agent context captures page beyond50 resume after session loss refuse stale progress and refresh", async () => {
  const book = await fixture();
  const source = await evidence(book);
  const plans = [];

  for (let index = 0; index < 103; index++) {
    plans.push(await post(book, "/change-sets", journal(source.id, "12500"), Accounting.ChangeSet));
  }

  const input = { goal: "close_the_year", period: null };
  const captureKey = key();

  const captureCommand = {
    method: "POST",
    headers: { "idempotency-key": captureKey },
    body: JSON.stringify(input),
  };

  const capture = await decoded(
    await request(book, "/workspace/context-captures", captureCommand),
    Capture,
  );

  expect(capture.total).toBe("103");
  expect(
    await decoded(await request(book, "/workspace/context-captures", captureCommand), Capture),
  ).toEqual(capture);
  const path = `/workspace/context-captures/${capture.id}`;
  const initial = await decoded(await request(book, path), Page);

  expect(initial.items).toHaveLength(50);
  expect(initial.next).toBe("50");
  expect(initial.current).toBe(true);
  const advanceKey = key();

  const advance = {
    method: "POST",
    headers: { "idempotency-key": advanceKey },
    body: JSON.stringify({ expectedRevision: "0", pageDigest: initial.pageDigest }),
  };

  const progressed = await decoded(await request(book, `${path}/progress`, advance), Progress);

  expect(progressed).toMatchObject({ revision: "1", position: "50" });
  expect(await decoded(await request(book, `${path}/progress`, advance), Progress)).toEqual(
    progressed,
  );
  const renewed = { ...book, token: (await createSession(book)).token };
  const resumed = await decoded(await request(renewed, path), Page);

  expect(resumed.offset).toBe("50");
  expect(resumed.items).toHaveLength(50);
  expect(resumed.next).toBe("100");
  await post(
    renewed,
    `${path}/progress`,
    { expectedRevision: "1", pageDigest: resumed.pageDigest },
    Progress,
  );
  const last = await decoded(await request(renewed, path), Page);

  expect(last.offset).toBe("100");
  expect(last.items).toHaveLength(3);
  expect(last.next).toBeNull();
  expect(
    [...initial.items, ...resumed.items, ...last.items].map((item) => item.identity).sort(),
  ).toEqual(plans.map((plan) => plan.id).sort());
  const foreign = await fixture();

  await failure(await request(foreign, path), 404, "NotFound");
  await failure(
    await request(renewed, `${path}/progress`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: "0", pageDigest: initial.pageDigest }),
    }),
    409,
    "StaleDependency",
  );
  const first = plans[0];

  if (!first) throw new Error("Synthetic plan missing");
  await execute(renewed, first);
  const stale = await decoded(await request(renewed, path), Page);

  expect(stale.current).toBe(false);
  expect(stale.items).toEqual(last.items);
  await failure(
    await request(renewed, `${path}/progress`, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: "2", pageDigest: last.pageDigest }),
    }),
    409,
    "StaleDependency",
  );
  const fresh = await post(renewed, "/workspace/context-captures", input, Capture);

  expect(fresh.total).toBe("102");
  expect(fresh.id).not.toBe(capture.id);
  const inspector = await database();

  try {
    expect(
      (
        await inspector.query(
          `select count(*)::int as count from openerp.agent_context_progress
      where book_id=$1 and capture_id=$2`,
          [book.bookId, capture.id],
        )
      ).rows,
    ).toEqual([{ count: 2 }]);
  } finally {
    await inspector.end();
  }

  await writeFile(
    join(environment().artifacts, "agent-context-durable-continuation.json"),
    JSON.stringify(
      {
        capture,
        initial,
        progressed,
        resumed,
        last,
        stale,
        fresh,
        expectedIds: plans.map((plan) => plan.id),
      },
      null,
      2,
    ),
  );
});
