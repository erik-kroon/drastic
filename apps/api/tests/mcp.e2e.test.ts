import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import { environment, execute, fixture, ledger, prepare } from "./support/fixtures";

const Envelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Finite,
  result: Schema.Unknown,
});
const Catalog = Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) });
const Initialized = Schema.Struct({
  protocolVersion: Schema.String,
  serverInfo: Schema.Struct({ name: Schema.String, version: Schema.String }),
});
const LedgerResult = Schema.Struct({
  structuredContent: Schema.Struct({ result: Accounting.LedgerSnapshot }),
});

test("MCP negotiates the protocol, exposes no approval tool, and reads the same committed ledger", async () => {
  const book = await fixture();
  const url = `${environment().baseUrl}/api/mcp`;
  const headers = {
    authorization: `Bearer ${book.agentToken}`,
    "content-type": "application/json",
    accept: "application/json",
    "MCP-Protocol-Version": "2025-11-25",
  };
  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "openerp-e2e", version: "1.0" },
    },
  });
  const unauthorized = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: initBody,
  });
  expect(unauthorized.status).toBe(401);
  const init = await fetch(url, { method: "POST", headers, body: initBody });
  expect(init.status).toBe(200);
  const initialized = Schema.decodeUnknownSync(Envelope)(await init.json());
  expect(Schema.decodeUnknownSync(Initialized)(initialized.result).protocolVersion).toBe(
    "2025-11-25",
  );
  const notified = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  expect(notified.status).toBe(202);
  expect(await notified.text()).toBe("");
  const catalogResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  expect(catalogResponse.status).toBe(200);
  const names = Schema.decodeUnknownSync(Catalog)(
    Schema.decodeUnknownSync(Envelope)(await catalogResponse.json()).result,
  ).tools.map((tool) => tool.name);
  expect(names).toContain("changes_execute");
  expect(names.filter((name) => /approv|activat/.test(name))).toEqual([]);
  await execute(book, await prepare(book));
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "ledger_snapshot",
        arguments: { scope: { entityId: book.entityId, bookId: book.bookId } },
      },
    }),
  });
  expect(response.status).toBe(200);
  const result = Schema.decodeUnknownSync(LedgerResult)(
    Schema.decodeUnknownSync(Envelope)(await response.json()).result,
  );
  expect(result.structuredContent.result).toEqual(await ledger(book));
  expect(result.structuredContent.result.sequence).toBe("1");
  const foreign = await fetch(url, {
    method: "POST",
    headers: { ...headers, origin: "https://foreign.example" },
    body: initBody,
  });
  expect(foreign.status).toBe(403);
});
