import { realpath } from "node:fs/promises";
import api from "../src/runtime/e2e";
import { inspectQueuedDocument } from "./document-inspection/inspection";
import { fileObjectStore } from "./file-object-store";
import { configuredProcessorFeed } from "../src/adapters/processor/local-fixture";
import { configuredPeppolAccessPoint } from "../src/adapters/peppol/local-fixture";
import type { Bindings } from "../src/runtime/environment";

const databaseUrl = process.env.DATABASE_URL;

const authSecret = process.env.BETTER_AUTH_SECRET;

const objectDirectory = process.env.OPENERP_OBJECT_DIRECTORY;

const publicUrl = process.env.BETTER_AUTH_URL;

if (!databaseUrl || !authSecret || authSecret.length < 32 || !objectDirectory || !publicUrl)
  throw new Error("Native browser API requires its disposable runtime configuration");

const origin = new URL(publicUrl);

if (
  origin.protocol !== "http:" ||
  origin.hostname !== "127.0.0.1" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw new Error("Native browser API requires a loopback browser origin");

const bindings: Bindings = {
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: authSecret,
  BETTER_AUTH_URL: origin.origin,
  DOCUMENT_INSPECTOR: inspectQueuedDocument,
  EVIDENCE_STORE: await fileObjectStore(await realpath(objectDirectory)),
  PROCESSOR_FEED: configuredProcessorFeed({
    OPENERP_PROCESSOR_FEED: process.env.OPENERP_PROCESSOR_FEED,
    OPENERP_PROCESSOR_ENDPOINT: process.env.OPENERP_PROCESSOR_ENDPOINT,
    OPENERP_PROCESSOR_SECRET: process.env.OPENERP_PROCESSOR_SECRET,
  }),
  PEPPOL_EXCHANGE: configuredPeppolAccessPoint({
    OPENERP_PEPPOL_EXCHANGE: process.env.OPENERP_PEPPOL_EXCHANGE,
    OPENERP_PEPPOL_ENDPOINT: process.env.OPENERP_PEPPOL_ENDPOINT,
    OPENERP_PEPPOL_SECRET: process.env.OPENERP_PEPPOL_SECRET,
  }),
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(origin.port) || 0,
  maxRequestBodySize: 8 * 1024 * 1024,
  fetch(request, server) {
    const host = request.headers.get("host");

    if (host !== origin.host && host !== `127.0.0.1:${server.port}`)
      return new Response("Unrecognized host", { status: 421 });

    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    const address = server.requestIP(request)?.address;

    if (address) headers.set("cf-connecting-ip", address);

    return api.fetch(
      new Request(new URL(url.pathname + url.search, origin), new Request(request, { headers })),
      bindings,
    );
  },
  error() {
    return new Response("Service unavailable", { status: 503 });
  },
});

console.info(JSON.stringify({ nativeApi: true, url: `http://127.0.0.1:${server.port}` }));

async function shutdown() {
  await server.stop(false);
}

process.once("SIGINT", () => void shutdown());

process.once("SIGTERM", () => void shutdown());
