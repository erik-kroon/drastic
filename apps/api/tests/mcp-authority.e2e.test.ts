import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import { Capabilities } from "@open-erp/contracts/capabilities";
import { capabilityAgentPolicy } from "../src/application/capabilities/agent-policy";
import {
  approve,
  database,
  environment,
  execution,
  fixture,
  key,
  persisted,
  prepare,
} from "./support/fixtures";

const Rpc = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.NullOr(Schema.Finite),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.Int,
      message: Schema.String,
      data: Schema.optional(Schema.Struct({ code: Accounting.FailureCode })),
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

  expect(inventory.filter((entry) => entry.classification === "unclassified")).toEqual([]);
  expect([...names].sort()).toEqual(
    inventory
      .filter((entry) => entry.exposed)
      .map((entry) => entry.name)
      .sort(),
  );

  const humanOnly = [
    "company_record_fact",
    "company_review_fact",
    "company_bind_role",
    "company_prepare_activation",
    "company_approve_activation",
    "company_execute_activation",
    "company_get_activation",
    "period_work_approve_batch",
    "period_work_execute_batch",
    "firm_create",
    "firm_save_client",
    "firm_remove_client",
    "firm_save_member",
    "company_create",
    "company_save_setup",
    "workspace_assign_work",
  ];

  for (const name of humanOnly) {
    expect(names).not.toContain(name);

    for (const token of [book.agentToken, book.token]) {
      const response = await rpc(token, "tools/call", { name, arguments: {} });
      expect(response.error).toEqual({ code: -32602, message: "Unknown tool." });
    }
  }

  for (const name of [
    "ledger_prepare_journal",
    "changes_execute",
    "bank_discover_match_candidates",
    "receipts_get",
  ]) {
    expect(names).toContain(name);
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
    403,
  );

  // MCP's credential check rejects this request before it dispatches a tool.
  expect(revoked.error?.code).toBe(-32001);
  expect(revoked.error?.data?.code).toBe("Forbidden");
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
        hiddenNames: humanOnly,
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
