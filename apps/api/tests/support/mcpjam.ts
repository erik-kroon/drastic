import { MCPClientManager } from "@mcpjam/sdk";
import type { McpProtocolVersion } from "@mcpjam/sdk";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { environment } from "./fixtures";
import type { BookFixture } from "./fixtures";

export async function connectMcpJam(book: BookFixture, protocolVersion: McpProtocolVersion) {
  const manager = new MCPClientManager(
    {},
    {
      defaultSupportedProtocolVersions: [protocolVersion],
      defaultTimeout: 15_000,
      retryPolicy: { retries: 0, retryDelayMs: 0 },
    },
  );

  try {
    await manager.connectToServer("drastic", {
      url: `${environment().baseUrl}/api/mcp`,
      requestInit: { headers: { Authorization: `Bearer ${book.agentToken}` } },
      mcpProtocolVersion: protocolVersion,
      disableSseFallback: true,
      supportedProtocolVersions: [protocolVersion],
    });

    return manager;
  } catch {
    await manager.disconnectServer("drastic");
    throw new Error(`MCPJam ${protocolVersion} connection failed against the synthetic runtime`);
  }
}

export async function saveMcpJamEvidence(name: string, evidence: object) {
  await writeFile(
    join(environment().artifacts, `mcpjam-${name}.json`),
    JSON.stringify(evidence, null, 2) + "\n",
    { mode: 0o600 },
  );
}
