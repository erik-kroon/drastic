import { serve, file as bunFile } from "bun";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import api from "../../src/index";
import { filesystemObjectStore } from "../../src/adapters/storage/filesystem-objects";
import { azureInvoiceReader } from "../../src/adapters/document-reading/azure";

const database = process.env.DATABASE_URL;

const token = process.env.FIXTURE_SESSION;

const root = process.env.EVIDENCE_STORE_ROOT;

const endpoint = process.env.DOCUMENT_READER_FIXTURE;

const ready = process.env.FIXTURE_READY;

const destination = process.env.FIXTURE_DESTINATION;

const secret = "synthetic-document-browser-proof-only-secret";

if (
  !database ||
  !token ||
  !root ||
  !endpoint ||
  !ready ||
  !destination ||
  new URL(endpoint).hostname !== "127.0.0.1"
)
  throw new Error("Local fixture configuration required.");

const reader = azureInvoiceReader(endpoint, "synthetic-local-key");

const assets = resolve(import.meta.dirname, "../../../web/dist/client");

const server = serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/__fixture/start") {
      const signature = createHmac("sha256", secret).update(token).digest("base64");

      return new Response(null, {
        status: 302,
        headers: {
          location: destination,
          "set-cookie": `openerp.session_token=${encodeURIComponent(`${token}.${signature}`)}; Path=/; HttpOnly; SameSite=Lax`,
        },
      });
    }

    if (url.pathname.startsWith("/api/"))
      return api.fetch(request, {
        DATABASE_URL: database,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: url.origin,
        EVIDENCE_STORE: filesystemObjectStore(root),
        DOCUMENT_READER: reader,
      });
    const path = resolve(assets, `.${url.pathname}`);

    if (!path.startsWith(`${assets}/`)) return new Response("Not found", { status: 404 });
    const file = bunFile(path);

    return new Response((await file.exists()) ? file : bunFile(resolve(assets, "_shell.html")));
  },
});

await writeFile(
  ready,
  JSON.stringify({ url: `http://127.0.0.1:${server.port}/__fixture/start`, synthetic: true }),
);

process.once("SIGTERM", () => {
  void server.stop(true);
});
