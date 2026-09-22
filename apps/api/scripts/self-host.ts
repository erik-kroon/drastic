import { resolve, sep } from "node:path";
import api from "../src/index";
import type { Bindings } from "../src/database";
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
if (!(await Bun.file(resolve(assets, "index.html")).exists())) {
  throw new Error("Build the web application before starting: bun run --cwd apps/web build");
}
const bindings: Bindings = {
  DATABASE_URL: databaseUrl,
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
    const content = (await file.exists()) ? file : Bun.file(resolve(path, "index.html"));
    if (!(await content.exists())) return new Response("Not found", { status: 404 });
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
  `OpenERP self-host listening on ${server.hostname}:${server.port}; public origin ${origin.origin}`,
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
