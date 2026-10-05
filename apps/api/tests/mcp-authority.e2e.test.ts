import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import { Capabilities } from "@open-erp/contracts/capabilities";
import { capabilityAgentPolicy } from "../src/application/capabilities/agent-policy";
import {
  approve,
  database,
  emptyPosting,
  environment,
  execution,
  fixture,
  key,
  ledger,
  persisted,
  prepare,
  request,
} from "./support/fixtures";

const Rpc = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.NullOr(Schema.Finite),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Int,
      message: Schema.String,
      data: Schema.optional(
        Schema.Struct({ code: Accounting.FailureCode, recovery: Accounting.RecoveryClass }),
      ),
    }),
  ),
});

const Catalog = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      annotations: Schema.Struct({ readOnlyHint: Schema.Boolean }),
    }),
  ),
});

const ReceiptResult = Schema.Struct({
  isError: Schema.Literal(false),
  structuredContent: Schema.Struct({ result: Accounting.ExecutionReceipt }),
});

const ToolFailure = Schema.Struct({
  isError: Schema.Literal(true),
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
});

async function rpc(token: string, method: string, params: Schema.JsonObject, expectedStatus = 200) {
  const response = await fetch(`${environment().baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  expect(response.status).toBe(expectedStatus);

  return Schema.decodeUnknownSync(Rpc)(await response.json());
}

function errorCode(result: unknown) {
  const failure = Schema.decodeUnknownSync(ToolFailure)(result);
  const text = failure.content[0]?.text;

  if (!text) throw new Error("A failed tool must report its typed error.");

  return Schema.decodeSync(Schema.fromJsonString(Schema.Struct({ code: Schema.String })))(text)
    .code;
}

test("MCP withholds human authority and preserves scoped approved execution and recovery", async () => {
  const book = await fixture();
  const other = await fixture();
  const scope = { entityId: book.entityId, bookId: book.bookId };

  const catalog = Schema.decodeUnknownSync(Catalog)(
    (await rpc(book.agentToken, "tools/list", {})).result,
  );

  const names = catalog.tools.map((tool) => tool.name);

  const inventory = Object.entries(Capabilities).map(([name, definition]) => ({
    name,
    readOnly: definition.readOnly,
    ...capabilityAgentPolicy(name, definition),
  }));

  const matrix = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({
        version: Schema.Literal(2),
        capabilities: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            readOnly: Schema.Boolean,
            classification: Schema.String,
            exposed: Schema.Boolean,
          }),
        ),
      }),
    ),
  )(
    await readFile(
      new URL("../../../docs/plans/permission-action-matrix.json", import.meta.url),
      "utf8",
    ),
  );

  expect(inventory.toSorted((left, right) => left.name.localeCompare(right.name))).toEqual(
    matrix.capabilities.toSorted((left, right) => left.name.localeCompare(right.name)),
  );
  expect([...names].sort()).toEqual(
    matrix.capabilities
      .filter((entry) => entry.exposed)
      .map((entry) => entry.name)
      .sort(),
  );

  for (const entry of matrix.capabilities) {
    if (entry.exposed) {
      expect(catalog.tools.find((tool) => tool.name === entry.name)?.annotations.readOnlyHint).toBe(
        entry.readOnly,
      );
      continue;
    }

    for (const token of [book.agentToken, book.token]) {
      const response = await rpc(token, "tools/call", { name: entry.name, arguments: {} });
      expect(response.error).toEqual({
        code: -32602,
        message: "Unknown tool.",
        data: { code: "InvalidRequest", recovery: "permanent" },
      });
    }
  }

  const plan = await prepare(book);
  const approval = await approve(book, plan);

  const command = {
    scope,
    changeSetId: plan.id,
    idempotencyKey: key(),
    input: execution(plan, approval),
  };

  const before = await persisted(book);

  for (const injected of [
    { ...command, owner: { family: "commerce", operation: "customer_credit" } },
    { ...command, input: { ...command.input, owner: { family: "commerce" } } },
  ]) {
    const response = await rpc(book.agentToken, "tools/call", {
      name: "changes_execute",
      arguments: injected,
    });

    expect(response.error?.code).toBe(-32602);
  }

  const wrongBook = await rpc(book.agentToken, "tools/call", {
    name: "changes_execute",
    arguments: {
      ...command,
      scope: { entityId: other.entityId, bookId: other.bookId },
    },
  });

  expect(errorCode(wrongBook.result)).toBe("Forbidden");
  expect(await persisted(book)).toEqual(before);

  const committed = Schema.decodeUnknownSync(ReceiptResult)(
    (
      await rpc(book.agentToken, "tools/call", {
        name: "changes_execute",
        arguments: command,
      })
    ).result,
  );

  const replayed = Schema.decodeUnknownSync(ReceiptResult)(
    (
      await rpc(book.agentToken, "tools/call", {
        name: "changes_execute",
        arguments: command,
      })
    ).result,
  );

  expect(replayed).toEqual(committed);

  const changed = await rpc(book.agentToken, "tools/call", {
    name: "changes_execute",
    arguments: {
      ...command,
      input: { ...command.input, approvalId: "approval_different" },
    },
  });

  expect(errorCode(changed.result)).toBe("IdempotencyConflict");

  const next = await prepare(book);
  const nextApproval = await approve(book, next);
  const beforeRevocation = await persisted(book);
  const admin = await database();

  try {
    await admin.query(
      "UPDATE openerp.credentials SET revoked_at = clock_timestamp() WHERE actor_id = $1",
      [book.agentId],
    );
  } finally {
    await admin.end();
  }

  const revoked = await rpc(
    book.agentToken,
    "tools/call",
    {
      name: "changes_execute",
      arguments: {
        scope,
        changeSetId: next.id,
        idempotencyKey: key(),
        input: execution(next, nextApproval),
      },
    },
    401,
  );

  expect(revoked.error?.code).toBe(-32001);
  expect(revoked.error?.data?.code).toBe("Unauthorized");
  expect(await persisted(book)).toEqual(beforeRevocation);

  const recovered = Schema.decodeUnknownSync(ReceiptResult)(
    (
      await rpc(book.token, "tools/call", {
        name: "receipts_get",
        arguments: { scope, key: command.idempotencyKey },
      })
    ).result,
  );

  expect(recovered.structuredContent.result).toEqual(committed.structuredContent.result);

  await writeFile(
    join(environment().artifacts, "mcp-authority-journey.json"),
    JSON.stringify(
      {
        catalog,
        inventory,
        hiddenNames: matrix.capabilities
          .filter((entry) => !entry.exposed)
          .map((entry) => entry.name),
        scope,
        committed,
        replayed,
        recovered,
        changedInputError: errorCode(changed.result),
        wrongBookError: errorCode(wrongBook.result),
        revokedError: revoked.error,
      },
      null,
      2,
    ),
  );
}, 60000);

test.each(["expired", "revoked", "unknown"])(
  "%s posting credentials have the same REST and MCP refusal without effects",
  async (state) => {
    const book = await fixture();
    const plan = await prepare(book);
    const approval = await approve(book, plan);
    const before = await persisted(book);
    const token = state === "unknown" ? key().repeat(2) : book.agentToken;
    const scope = { entityId: book.entityId, bookId: book.bookId };
    const input = execution(plan, approval);
    const commandKey = key();

    if (state !== "unknown") {
      const admin = await database();

      try {
        if (state === "expired")
          await admin.query(
            "UPDATE openerp.credentials SET expires_at = clock_timestamp() - interval '1 second' WHERE actor_id = $1",
            [book.agentId],
          );
        else
          await admin.query(
            "UPDATE openerp.credentials SET revoked_at = clock_timestamp() WHERE actor_id = $1",
            [book.agentId],
          );
      } finally {
        await admin.end();
      }
    }

    const response = await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "idempotency-key": commandKey },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(401);

    const rest = await response.json();

    expect(rest).toMatchObject({ code: "Unauthorized", recovery: "permanent" });

    const mcp = await rpc(
      token,
      "tools/call",
      {
        name: "changes_execute",
        arguments: { scope, changeSetId: plan.id, idempotencyKey: commandKey, input },
      },
      401,
    );

    expect(mcp.error?.code).toBe(-32001);
    expect(mcp.error?.data).toMatchObject({ code: rest.code, recovery: rest.recovery });
    expect(await persisted(book)).toEqual(before);
    await writeFile(
      join(environment().artifacts, `mcp-posting-${state}-credential-parity.json`),
      JSON.stringify(
        { state, scope, commandKey, rest, mcp, before, after: await persisted(book) },
        null,
        2,
      ),
    );
  },
);

test.each([
  ["stale_dependency", "StaleDependency", 409],
  ["expired_approval", "ApprovalRequired", 403],
] satisfies [string, typeof Accounting.FailureCode.Type, number][])(
  "%s execution has the same REST and MCP refusal without effects",
  async (state, code, status) => {
    const book = await fixture();
    const plan = await prepare(book);
    const approval = await approve(book, plan);
    const scope = { entityId: book.entityId, bookId: book.bookId };
    const input = execution(plan, approval);
    const commandKey = key();
    const before = await persisted(book);
    const ledgerBefore = await ledger(book);
    const admin = await database();

    expect(before).toEqual(emptyPosting);

    try {
      if (state === "stale_dependency") {
        const changed = await admin.query(
          "UPDATE openerp.accounts SET version = version + 1 WHERE book_id = $1 AND id = 'account_bank'",
          [book.bookId],
        );

        expect(changed.rowCount).toBe(1);
      } else {
        await admin.query("ALTER TABLE openerp.approvals DISABLE TRIGGER ALL");

        try {
          const changed = await admin.query(
            "UPDATE openerp.approvals SET expires_at = clock_timestamp() - interval '1 second' WHERE book_id = $1 AND id = $2",
            [book.bookId, approval.id],
          );

          expect(changed.rowCount).toBe(1);
        } finally {
          await admin.query("ALTER TABLE openerp.approvals ENABLE TRIGGER ALL");
        }
      }
    } finally {
      await admin.end();
    }

    const response = await request(book, `/change-sets/${plan.id}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${book.agentToken}`, "idempotency-key": commandKey },
      body: JSON.stringify(input),
    });

    expect(response.status).toBe(status);

    const rest = Schema.decodeUnknownSync(Accounting.AccountingError)(await response.json());

    expect(rest).toMatchObject({ code, recovery: "permanent" });
    expect(await persisted(book)).toEqual(before);
    expect(await ledger(book)).toEqual(ledgerBefore);

    const mcp = await rpc(book.agentToken, "tools/call", {
      name: "changes_execute",
      arguments: { scope, changeSetId: plan.id, idempotencyKey: commandKey, input },
    });

    const refused = Schema.decodeUnknownSync(ToolFailure)(mcp.result);
    const text = refused.content[0]?.text;

    if (!text) throw new Error("A refused execution must report its typed error.");

    const mcpFailure = Schema.decodeSync(
      Schema.fromJsonString(
        Schema.Struct({
          code: Accounting.FailureCode,
          message: Schema.String,
          recovery: Accounting.RecoveryClass,
        }),
      ),
    )(text);

    const after = await persisted(book);
    const ledgerAfter = await ledger(book);

    expect(mcpFailure).toEqual({ code: rest.code, message: rest.message, recovery: rest.recovery });
    expect(after).toEqual(before);
    expect(ledgerAfter).toEqual(ledgerBefore);
    await writeFile(
      join(environment().artifacts, `mcp-posting-${state}-parity.json`),
      JSON.stringify(
        {
          state,
          scope,
          commandKey,
          plan,
          approval,
          rest,
          mcp,
          before,
          after,
          ledgerBefore,
          ledgerAfter,
        },
        null,
        2,
      ),
    );
  },
);

test("unknown posting key has the same timed REST and MCP absence without effects", async () => {
  const book = await fixture();
  const scope = { entityId: book.entityId, bookId: book.bookId };
  const originalKey = key();
  const before = await persisted(book);
  const ledgerBefore = await ledger(book);
  const response = await request(book, `/posting-requests/${originalKey}`);

  expect(response.status).toBe(200);

  const rest = Schema.decodeUnknownSync(Recovery.RecoveredPostingRequest)(await response.json());

  const mcp = await rpc(book.token, "tools/call", {
    name: "posting_recover_request",
    arguments: { scope, key: originalKey },
  });

  const recovered = Schema.decodeUnknownSync(
    Schema.Struct({
      isError: Schema.Literal(false),
      structuredContent: Schema.Struct({ result: Recovery.RecoveredPostingRequest }),
    }),
  )(mcp.result).structuredContent.result;

  const expected = {
    scope,
    key: originalKey,
    state: "not_observed",
    operation: null,
    actorId: null,
    requestDigest: null,
    result: null,
    recordedAt: null,
    sameActor: null,
  };

  const after = await persisted(book);
  const ledgerAfter = await ledger(book);

  expect(rest).toMatchObject(expected);
  expect(recovered).toMatchObject(expected);
  expect(Number.isFinite(Date.parse(rest.checkedAt))).toBe(true);
  expect(Number.isFinite(Date.parse(recovered.checkedAt))).toBe(true);
  expect(before).toEqual(emptyPosting);
  expect(after).toEqual(before);
  expect(ledgerAfter).toEqual(ledgerBefore);
  await writeFile(
    join(environment().artifacts, "mcp-posting-unknown-key-parity.json"),
    JSON.stringify(
      { scope, originalKey, rest, mcp, before, after, ledgerBefore, ledgerAfter },
      null,
      2,
    ),
  );
});
