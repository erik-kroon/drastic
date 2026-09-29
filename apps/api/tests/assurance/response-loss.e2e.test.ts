import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  approve,
  decoded,
  environment,
  execution,
  fixture,
  onePosting,
  persisted,
  prepare,
  request,
} from "../support/fixtures";
import { freshCommandCount, saveSanitizedJourney } from "./database-support";

test("[ASR-UNKNOWN-COMMIT] a proxy loses the successful response after the Worker commits", async () => {
  const book = await fixture();
  const plan = await prepare(book);
  const approval = await approve(book, plan);
  const key = randomUUID();
  const payload = JSON.stringify(execution(plan, approval));
  const target = `${environment().baseUrl}${book.path}/change-sets/${plan.id}/execute`;
  const targetURL = new URL(target);
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(targetURL.hostname);
  let upstreamStatus: number | undefined;
  let committedBody: string | undefined;
  let proxyError: unknown;
  let forwarded = false;
  const operations: Promise<void>[] = [];

  const proxy = createServer((incoming, outgoing) => {
    const op = (async () => {
      if (forwarded || incoming.method !== "POST" || incoming.url !== "/drop-once") {
        outgoing.writeHead(400).end();

        return;
      }

      forwarded = true;
      const chunks: Buffer[] = [];

      for await (const chunk of incoming)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString("utf8")).toBe(payload);

      const result = await fetch(target, {
        method: "POST",
        headers: {
          authorization: `Bearer ${book.token}`,
          "idempotency-key": key,
          "content-type": "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });

      upstreamStatus = result.status;
      committedBody = await result.text();
      // Completion is deliberately AFTER the full upstream success was received.
      // The client never receives that successful response.
      outgoing.destroy();
    })().catch((error) => {
      proxyError = error;
      outgoing.destroy();
    });

    operations.push(op);
  });

  try {
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const address = proxy.address();

    if (!address || typeof address === "string") throw new Error("No proxy address");
    await expect(
      fetch(`http://127.0.0.1:${address.port}/drop-once`, {
        method: "POST",
        body: payload,
        signal: AbortSignal.timeout(20_000),
      }),
    ).rejects.toBeInstanceOf(Error);
    await Promise.all(operations);

    if (proxyError) throw proxyError;
    expect(upstreamStatus).toBe(200);
    expect(await persisted(book)).toEqual(onePosting);
    expect(await freshCommandCount(book, key)).toBe(1);

    if (committedBody === undefined) throw new Error("Missing committed upstream evidence");

    const original = await decoded(
      new Response(committedBody, { status: 200 }),
      Accounting.ExecutionReceipt,
    );

    const recovered = await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: payload,
      }),
      Accounting.ExecutionReceipt,
    );

    expect(recovered).toEqual(original);
    expect(await persisted(book)).toEqual(onePosting);
    await saveSanitizedJourney("post-commit-response-loss", {
      bookId: book.bookId,
      key,
      upstreamStatus,
      receipt: recovered,
      persisted: await persisted(book),
    });
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve())),
    );
    await Promise.all(operations);
  }
});
