import { AccountingError } from "@open-erp/contracts/accounting";
import { AccountingErrorStatus } from "@open-erp/contracts/api";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as McpSchema from "effect/unstable/ai/McpSchema";
import * as Tool from "effect/unstable/ai/Tool";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { authenticate, sameOrigin } from "./http/auth";
import { capabilities } from "../application/capabilities";
import { failure } from "../application/failures";
import { RequestEnvironment } from "../runtime/environment";

const protocolVersions = ["2025-11-25", "2025-06-18"];
const latestProtocolVersion = "2025-11-25";
const McpRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(McpSchema.RequestId),
  method: Schema.String,
  params: Schema.optional(Schema.JsonObject),
});
const CallTool = Schema.Struct({
  ...McpSchema.CallTool.payloadSchema.fields,
  arguments: Schema.optional(Schema.JsonObject),
});
const tools = Object.entries(capabilities).map(([name, capability]) => ({ name, capability }));
const catalog = tools.map(({ name, capability }) => ({
  name,
  description: capability.description,
  inputSchema: Tool.getJsonSchemaFromSchema(capability.input),
  outputSchema: Tool.getJsonSchemaFromSchema(Schema.Struct({ result: capability.output })),
  annotations: {
    readOnlyHint: capability.readOnly,
    destructiveHint: !capability.readOnly,
    idempotentHint: true,
    openWorldHint: false,
  },
}));

function rpcError(id: McpSchema.RequestId | null, code: number, message: string, status = 200) {
  return HttpServerResponse.jsonUnsafe(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status },
  );
}

function rpcResult<A>(id: McpSchema.RequestId, result: A) {
  return HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id, result });
}

function dispatch(request: typeof McpRequest.Type, token: string) {
  return Effect.gen(function* () {
    if (request.id === undefined) {
      if (
        request.method === "notifications/initialized" &&
        Result.isSuccess(
          Schema.decodeResult(McpSchema.InitializedNotification.payloadSchema)(request.params),
        )
      ) {
        return HttpServerResponse.empty({ status: 202 });
      }
      return HttpServerResponse.empty({ status: 400 });
    }
    const id = request.id;
    switch (request.method) {
      case "initialize": {
        const input = Schema.decodeUnknownResult(McpSchema.Initialize.payloadSchema)(
          request.params,
        );
        if (Result.isFailure(input))
          return rpcError(id, -32602, "Invalid initialization parameters.");
        const offered = input.success.protocolVersion;
        return rpcResult(id, {
          protocolVersion: protocolVersions.includes(offered) ? offered : latestProtocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "open-erp-accounting", version: "1.0.0" },
          instructions:
            "Discover available operations with tools/list and inspect book_get_status for scope and blockers. Installed capabilities are not proof of production accounting, tax, whole-period source completeness or Swedish compliance. Prepare, validate, obtain operator approval outside MCP, then execute the exact approved digest and version. Reuse idempotency keys when retrying unchanged commands; recover durable requests and receipts after an uncertain response. Stateless JSON responses only; no SSE, subscriptions or MCP background-task protocol.",
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list": {
        const input = Schema.decodeResult(McpSchema.ListTools.payloadSchema)(request.params);
        if (Result.isFailure(input) || input.success?.cursor !== undefined) {
          return rpcError(id, -32602, "This catalog does not use a cursor.");
        }
        return rpcResult(id, { tools: catalog });
      }
      case "tools/call": {
        const input = Schema.decodeUnknownResult(CallTool)(request.params);
        if (Result.isFailure(input)) return rpcError(id, -32602, "Invalid tool call parameters.");
        const tool = tools.find((entry) => entry.name === input.success.name);
        if (!tool) return rpcError(id, -32602, "Unknown tool.");
        const call: Effect.Effect<
          Schema.Json,
          AccountingError | Schema.SchemaError,
          RequestEnvironment
        > = tool.capability.invoke(token, input.success.arguments ?? {});
        return yield* call.pipe(
          Effect.match({
            onFailure: (error) => {
              if (error._tag === "SchemaError")
                return rpcError(id, -32602, "Invalid tool arguments.");
              return rpcResult(id, {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ code: error.code, message: error.message }),
                  },
                ],
              });
            },
            onSuccess: (result) =>
              rpcResult(id, {
                isError: false,
                content: [{ type: "text", text: JSON.stringify({ result }) }],
                structuredContent: { result },
              }),
          }),
        );
      }
      default:
        return rpcError(id, -32601, "Method not found.");
    }
  });
}

const handleMcp = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (request.headers.origin !== undefined) yield* sameOrigin;
  if (request.headers.authorization === undefined) return yield* failure("Unauthorized");
  const token = yield* authenticate;
  // Catalog discovery and initialization also verify the credential in PostgreSQL.
  yield* capabilities.book_list.execute(token, {});
  if (request.method !== "POST") {
    return HttpServerResponse.empty({ status: 405, headers: { allow: "POST" } });
  }
  if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return rpcError(null, -32600, "Content-Type must be application/json.", 415);
  }
  const accepted = (request.headers.accept ?? "*/*")
    .split(",")
    .map((part) => part.trim().toLowerCase());
  if (
    !accepted.some(
      (part) =>
        ["application/json", "application/*", "*/*"].includes((part.split(";")[0] ?? "").trim()) &&
        !/;\s*q=0(?:\.0*)?(?:;|$)/.test(part),
    )
  ) {
    return rpcError(null, -32600, "Accept must allow application/json.", 406);
  }
  const body = yield* Effect.result(request.json);
  if (Result.isFailure(body)) return rpcError(null, -32700, "Parse error.", 400);
  const decoded = Schema.decodeUnknownResult(McpRequest)(body.success);
  if (Result.isFailure(decoded))
    return rpcError(null, -32600, "Send one JSON-RPC request or notification.", 400);
  const input = decoded.success;
  const version = request.headers["mcp-protocol-version"];
  if (
    input.method !== "initialize" &&
    (version === undefined || !protocolVersions.includes(version))
  ) {
    return rpcError(input.id ?? null, -32600, "Send a supported MCP-Protocol-Version header.", 400);
  }
  return yield* dispatch(input, token);
}).pipe(Effect.catch((error) => rpcAuthenticationError(error)));

function rpcAuthenticationError(error: AccountingError) {
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: error.message, data: { code: error.code } },
      },
      {
        status: AccountingErrorStatus[error.code],
        headers:
          error.code === "Unauthorized"
            ? { "www-authenticate": 'Bearer realm="OpenERP"' }
            : undefined,
      },
    ),
  );
}

// Stateless transport: no in-memory sessions, server notifications or SSE streams.
export const McpRoutes = HttpRouter.add("*", "/api/mcp", handleMcp);
