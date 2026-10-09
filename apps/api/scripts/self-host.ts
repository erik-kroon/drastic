import { inspectDocument } from "./document-inspection/inspection";
import { configuredDocumentDelivery } from "../src/adapters/documents/local-fixture";
import { configuredPeppolAccessPoint } from "../src/adapters/peppol/local-fixture";
import { configuredProcessorFeed } from "../src/adapters/processor/local-fixture";
import { resolve, sep } from "node:path";
import api from "../src/index";
import { configuredDocumentReader } from "../src/runtime/document-reader";
import type { Bindings } from "../src/runtime/environment";
import { fileObjectStore } from "./file-object-store";

const databaseUrl = process.env.DATABASE_URL;

const authSecret = process.env.BETTER_AUTH_SECRET;

if (!databaseUrl || !authSecret || authSecret.length < 32) {
  throw new Error("Set DATABASE_URL and a BETTER_AUTH_SECRET of at least 32 characters.");
}

const origin = new URL(process.env.OPENERP_PUBLIC_URL ?? "http://localhost:3000");

const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);

if (
  (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
) {
  throw new Error("OPENERP_PUBLIC_URL must be an HTTPS origin, or HTTP on loopback.");
}

const port = Number(process.env.PORT ?? "3000");

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be 1–65535.");

const assets = resolve(import.meta.dirname, "../../web/dist/client");

if (!(await Bun.file(resolve(assets, "_shell.html")).exists())) {
  throw new Error("Build the web application before starting: bun run --cwd apps/web build");
}

const documentReader = configuredDocumentReader(process.env);

if (documentReader && !process.env.OPENERP_PREPARATION_TOKEN)
  throw new Error("Document reading requires a configured preparation runner token.");

const bindings: Bindings = {
  DOCUMENT_INSPECTOR: inspectDocument,
  DATABASE_URL: databaseUrl,
  DOCUMENT_READER: documentReader,
  PEPPOL_EXCHANGE: configuredPeppolAccessPoint({
    OPENERP_PEPPOL_EXCHANGE: process.env.OPENERP_PEPPOL_EXCHANGE,
    OPENERP_PEPPOL_ENDPOINT: process.env.OPENERP_PEPPOL_ENDPOINT,
    OPENERP_PEPPOL_SECRET: process.env.OPENERP_PEPPOL_SECRET,
  }),
  DOCUMENT_DELIVERY: configuredDocumentDelivery({
    OPENERP_DOCUMENT_DELIVERY: process.env.OPENERP_DOCUMENT_DELIVERY,
    OPENERP_DOCUMENT_ENDPOINT: process.env.OPENERP_DOCUMENT_ENDPOINT,
    OPENERP_DOCUMENT_SECRET: process.env.OPENERP_DOCUMENT_SECRET,
    OPENERP_DOCUMENT_PUBLIC_KEY: process.env.OPENERP_DOCUMENT_PUBLIC_KEY,
    OPENERP_DOCUMENT_KEY_ID: process.env.OPENERP_DOCUMENT_KEY_ID,
  }),
  PROCESSOR_FEED: configuredProcessorFeed({
    OPENERP_PROCESSOR_FEED: process.env.OPENERP_PROCESSOR_FEED,
    OPENERP_PROCESSOR_ENDPOINT: process.env.OPENERP_PROCESSOR_ENDPOINT,
    OPENERP_PROCESSOR_SECRET: process.env.OPENERP_PROCESSOR_SECRET,
  }),
  OPENERP_PREPARATION_TOKEN: process.env.OPENERP_PREPARATION_TOKEN,
  BETTER_AUTH_SECRET: authSecret,
  BETTER_AUTH_URL: origin.origin,
  EVIDENCE_STORE: process.env.OPENERP_OBJECT_DIRECTORY
    ? await fileObjectStore(process.env.OPENERP_OBJECT_DIRECTORY)
    : undefined,
};

const server = Bun.serve({
  hostname: process.env.OPENERP_BIND_ADDRESS ?? "127.0.0.1",
  port,
  maxRequestBodySize: 8 * 1024 * 1024,
  async fetch(request, server) {
    if (request.headers.get("host") !== origin.host) {
      return new Response("Unrecognized host", { status: 421 });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const headers = new Headers(request.headers);
      headers.delete("cf-connecting-ip");
      const address = server.requestIP(request)?.address;

      if (address) headers.set("cf-connecting-ip", address);
      const canonical = new URL(url.pathname + url.search, origin);

      return api.fetch(
        new Request(canonical.toString(), new Request(request, { headers })),
        bindings,
      );
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    let pathname: string;

    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Invalid path", { status: 400 });
    }

    const path = resolve(assets, `.${pathname}`);

    if (
      (path !== assets && !path.startsWith(assets + sep)) ||
      pathname.includes("\\") ||
      pathname.includes("\0")
    ) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(path);
    let content = (await file.exists()) ? file : Bun.file(resolve(path, "index.html"));

    if (!(await content.exists())) {
      const navigation = request.headers.get("accept")?.includes("text/html");

      if (!navigation || pathname.startsWith("/assets/"))
        return new Response("Not found", { status: 404 });

      content = Bun.file(resolve(assets, "_shell.html"));
    }

    return new Response(request.method === "HEAD" ? null : content, {
      headers: {
        "content-type": content.type,
        "content-length": String(content.size),
        "cache-control": pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  },
  error() {
    console.error("Self-host request failed.");

    return new Response("Service unavailable", { status: 503 });
  },
});

console.info(
  `Drastic self-host listening on ${server.hostname}:${server.port}; public origin ${origin.origin}`,
);

async function shutdown() {
  await server.stop(false);
  process.exitCode = 0;
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});
