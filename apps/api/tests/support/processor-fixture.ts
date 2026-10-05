import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import * as Schema from "effect/Schema";
import * as Processor from "@open-erp/contracts/processor-clearing";

const Dataset = Schema.Struct({
  profile: Processor.ProviderPage.fields.profile,
  accountId: Processor.ProviderPage.fields.accountId,
  liveMode: Schema.Boolean,
  currency: Processor.ProviderPage.fields.currency,
  currencyScale: Processor.ProviderPage.fields.currencyScale,
  startsOn: Processor.ProviderPage.fields.startsOn,
  endsOn: Processor.ProviderPage.fields.endsOn,
  openingMinor: Processor.ProviderPage.fields.openingMinor,
  closingMinor: Processor.ProviderPage.fields.closingMinor,
  complete: Schema.Boolean,
  rows: Schema.Array(Processor.ProviderRow),
  lostResponses: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 }))),
  pageSize: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});

export async function startProcessorFixture() {
  const secret = randomBytes(32).toString("hex");
  const accounts = new Map<string, typeof Dataset.Type>();
  const remainingLosses = new Map<string, number>();

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    if (request.headers.authorization !== `Bearer ${secret}`) {
      response.writeHead(401).end();

      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    try {
      if (request.method === "PUT" && url.pathname.startsWith("/fixtures/")) {
        let body = "";

        for await (const chunk of request) {
          body += chunk.toString();

          if (Buffer.byteLength(body) > 65536) throw new Error("Fixture seed exceeds its bound");
        }

        const dataset = Schema.decodeSync(Schema.fromJsonString(Dataset))(body, {
          onExcessProperty: "error",
        });

        const accountId = decodeURIComponent(url.pathname.slice("/fixtures/".length));

        if (dataset.accountId !== accountId) throw new Error("Fixture account identity mismatch");
        accounts.set(accountId, dataset);
        remainingLosses.set(accountId, dataset.lostResponses ?? 0);
        response.writeHead(200, { "content-type": "application/json" }).end('{"retained":true}');

        return;
      }

      if (request.method !== "GET" || url.pathname !== "/balance-transactions") {
        response.writeHead(404).end();

        return;
      }

      const accountId = url.searchParams.get("account") ?? "";
      const dataset = accounts.get(accountId);

      if (!dataset) {
        response.writeHead(404).end();

        return;
      }

      const losses = remainingLosses.get(accountId) ?? 0;

      if (losses > 0) {
        remainingLosses.set(accountId, losses - 1);
        response.destroy();

        return;
      }

      const cursor = url.searchParams.get("cursor");
      const offset = cursor === null ? 0 : Number(cursor);

      if (!Number.isSafeInteger(offset) || offset < 0 || offset > dataset.rows.length)
        throw new Error("Invalid fixture cursor");
      const size = dataset.pageSize ?? 100;
      const view = url.searchParams.get("view");

      if (view !== "balance" && view !== "automatic_payout")
        throw new Error("Invalid fixture view");
      const nextOffset = offset + size;

      const page: typeof Processor.ProviderPage.Type = {
        profile: dataset.profile,
        accountId: dataset.accountId,
        liveMode: dataset.liveMode,
        currency: dataset.currency,
        currencyScale: dataset.currencyScale,
        startsOn: dataset.startsOn,
        endsOn: dataset.endsOn,
        openingMinor: dataset.openingMinor,
        closingMinor: dataset.closingMinor,
        complete: dataset.complete,
        view,
        providerPayoutId: url.searchParams.get("payout"),
        cursor,
        nextCursor: nextOffset < dataset.rows.length ? String(nextOffset) : null,
        reportId: `report_${accountId}_${dataset.startsOn}_${dataset.endsOn}`,
        rows: dataset.rows.slice(offset, nextOffset),
      };

      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(page));
    } catch {
      response
        .writeHead(422, { "content-type": "application/json" })
        .end('{"error":"Invalid synthetic processor request"}');
    }
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
    throw new Error("Processor fixture did not bind loopback");

  return {
    url: `http://127.0.0.1:${address.port}`,
    secret,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
