import { assertCallToolResult } from "@mcpjam/sdk";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import { approve, execution, fixture, key, ledger, prepare } from "./support/fixtures";
import { connectMcpJam, saveMcpJamEvidence } from "./support/mcpjam";

const LedgerResult = Schema.Struct({ result: Accounting.LedgerSnapshot });

const ReceiptResult = Schema.Struct({ result: Accounting.ExecutionReceipt });

// Temporarily disabled by request: MCPJam fetch fails with SocketError: other side closed.
test.skip.each(["2025-06-18", "2025-11-25"] as const)(
  "MCPJam %s preserves scope, exact approval and one persisted execution",
  async (protocolVersion) => {
    const book = await fixture();
    const foreign = await fixture();
    const manager = await connectMcpJam(book, protocolVersion);

    try {
      const catalog = await manager.listTools("drastic");
      const tools = catalog.tools;
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((tool) => tool.description && tool.inputSchema && tool.outputSchema)).toBe(
        true,
      );
      expect(
        tools.filter((tool) => /approv|activat/.test(tool.name) && !tool.annotations?.readOnlyHint),
      ).toEqual([]);

      const scope = { entityId: book.entityId, bookId: book.bookId };
      const before = await ledger(book);

      const forbidden = assertCallToolResult(
        await manager.executeTool("drastic", "ledger_snapshot", {
          scope: { entityId: foreign.entityId, bookId: foreign.bookId },
        }),
      );

      expect(forbidden.isError).toBe(true);

      const plan = await prepare(book);

      const refused = assertCallToolResult(
        await manager.executeTool("drastic", "changes_execute", {
          scope,
          changeSetId: plan.id,
          idempotencyKey: key(),
          input: {
            planDigest: plan.planDigest,
            version: plan.version,
            approvalId: "missing_approval",
          },
        }),
      );

      expect(refused.isError).toBe(true);
      expect(await ledger(book)).toEqual(before);

      const approval = await approve(book, plan);

      const argumentsForExecution = {
        scope,
        changeSetId: plan.id,
        idempotencyKey: key(),
        input: execution(plan, approval),
      };

      const first = assertCallToolResult(
        await manager.executeTool("drastic", "changes_execute", argumentsForExecution),
      );

      expect(first.isError).toBe(false);
      const receipt = Schema.decodeUnknownSync(ReceiptResult)(first.structuredContent).result;

      const retry = assertCallToolResult(
        await manager.executeTool("drastic", "changes_execute", argumentsForExecution),
      );

      expect(retry.isError).toBe(false);
      expect(Schema.decodeUnknownSync(ReceiptResult)(retry.structuredContent).result).toEqual(
        receipt,
      );

      const snapshot = assertCallToolResult(
        await manager.executeTool("drastic", "ledger_snapshot", { scope }),
      );

      expect(snapshot.isError).toBe(false);
      const retained = Schema.decodeUnknownSync(LedgerResult)(snapshot.structuredContent).result;
      expect(retained).toEqual(await ledger(book));
      expect(retained.sequence).toBe("1");
      await saveMcpJamEvidence(`protocol-${protocolVersion}`, {
        protocolVersion,
        tools: tools.map((tool) => ({ name: tool.name, annotations: tool.annotations })),
        foreignScopeRefused: forbidden.isError,
        missingApprovalRefused: refused.isError,
        receipt,
        ledger: retained,
        retryReturnedOriginalReceipt: true,
      });
    } finally {
      await manager.disconnectServer("drastic");
    }
  },
  180_000,
);
