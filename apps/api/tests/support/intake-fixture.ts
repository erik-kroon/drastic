import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

export async function startIntakeFixture() {
  const secret = randomBytes(32).toString("hex");
  const datasets = new Map<string, unknown>();
  let fetchCount = 0;

  async function handleRequest(
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse,
  ) {
    if (request.headers.authorization !== `Bearer ${secret}`) {
      response.writeHead(401).end();

      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    const identity = JSON.stringify([
      url.searchParams.get("provider"),
      url.searchParams.get("account"),
      url.searchParams.get("folder"),
      url.searchParams.get("cursor"),
    ]);

    if (request.method === "POST" && url.pathname === "/dataset") {
      const chunks: Uint8Array[] = [];

      for await (const chunk of request) chunks.push(chunk);
      datasets.set(identity, JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(204).end();

      return;
    }

    if (request.method === "GET" && url.pathname === "/metrics") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ fetchCount }));

      return;
    }

    if (request.method === "GET" && url.pathname === "/page") {
      fetchCount += 1;
      const page = datasets.get(identity);

      if (
        page !== null &&
        typeof page === "object" &&
        "transport" in page &&
        page.transport === "disconnect"
      ) {
        response.destroy();

        return;
      }

      response
        .writeHead(page === undefined ? 404 : 200, { "content-type": "application/json" })
        .end(JSON.stringify(page ?? { error: "NotFound" }));

      return;
    }

    response.writeHead(404).end();
  }

  const server = createServer((request, response) => {
    handleRequest(request, response).catch(() => response.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (!address || typeof address === "string")
    throw new Error("Intake fixture did not bind loopback");

  return {
    url: `http://127.0.0.1:${address.port}`,
    secret,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
