import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Source from "@open-erp/contracts/source-intake";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import { localDocumentReader } from "../../src/adapters/document-reading/local-fixture";
import { RequestEnvironment, type Bindings } from "../../src/runtime/environment";
import { databaseLayer } from "../../src/db/connection";
import { runSupplierExtraction } from "../../src/application/purchases/extraction";
import api from "../../src/index";
import { inspectQueuedDocument } from "./inspection";

const Input = Schema.Struct({
  databaseUrl: Schema.String,
  token: Schema.String,
  authSecret: Schema.String,
  origin: Schema.String,
  email: Schema.String,
  password: Schema.String,
  output: Schema.String,
});

const inputFile = process.argv[2];

if (!inputFile || !basename(dirname(inputFile)).startsWith("openerp-paper-"))
  throw new Error("Use the disposable browser runtime");

const input = Schema.decodeSync(Schema.fromJsonString(Input))(await readFile(inputFile, "utf8"));

const origin = new URL(input.origin);

if (
  origin.hostname !== "127.0.0.1" ||
  origin.protocol !== "http:" ||
  !input.databaseUrl.includes("@127.0.0.1:")
)
  throw new Error("Only synthetic loopback services are allowed");

const text = ["DOC-113", "1250,00 SEK", "Second page"];

const streams = [
  `BT /F1 14 Tf 30 250 Td (${text[0]}) Tj ET\nBT /F1 14 Tf 30 210 Td (${text[1]}) Tj ET`,
  `BT /F1 14 Tf 30 250 Td (${text[2]}) Tj ET`,
];

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ...streams.map(
    (stream) => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ),
];

let pdf = "%PDF-1.4\n";

const offsets: number[] = [];

for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}

const xref = Buffer.byteLength(pdf);

pdf += `xref\n0 8\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

const original = Buffer.from(pdf);

let submissions = 0;

const response = {
  status: "succeeded",
  analyzeResult: {
    apiVersion: "2024-11-30",
    modelId: "prebuilt-invoice",
    stringIndexType: "utf16CodeUnit",
    content: text.join("\n"),
    pages: [
      {
        pageNumber: 1,
        spans: [{ offset: 0, length: 19 }],
        width: 300 / 72,
        height: 300 / 72,
        unit: "inch",
      },
      {
        pageNumber: 2,
        spans: [{ offset: 20, length: 11 }],
        width: 300 / 72,
        height: 300 / 72,
        unit: "inch",
      },
    ],
    documents: [
      {
        docType: "prebuilt:invoice",
        fields: {
          InvoiceId: {
            content: "DOC-113",
            spans: [{ offset: 0, length: 7 }],
            confidence: 0.95,
            boundingRegions: [
              {
                pageNumber: 1,
                polygon: [30, 36, 98, 36, 98, 54, 30, 54].map((point) => point / 72),
              },
            ],
          },
          InvoiceTotal: {
            content: "1250,00 SEK",
            spans: [{ offset: 8, length: 11 }],
            confidence: 0.2,
            boundingRegions: [
              {
                pageNumber: 1,
                polygon: [30, 76, 125, 76, 125, 96, 30, 96].map((point) => point / 72),
              },
            ],
          },
          VendorName: { content: "Unsupported supplier proposal" },
        },
      },
    ],
  },
};

let endpoint = "";

const provider = createServer((request, outgoing) => {
  void (async () => {
    if (request.method === "POST") {
      let body = "";

      for await (const chunk of request) body += chunk.toString();

      const posted = Schema.decodeSync(
        Schema.fromJsonString(Schema.Struct({ base64Source: Schema.String })),
      )(body);

      if (!Buffer.from(posted.base64Source, "base64").equals(original))
        throw new Error("Unexpected source disclosure");
      submissions++;
      outgoing
        .writeHead(202, {
          "operation-location": `${endpoint}/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/synthetic-113?api-version=2024-11-30`,
        })
        .end();
    } else {
      outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(response));
    }
  })().catch(() => outgoing.writeHead(422).end());
});

try {
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const address = provider.address();

  if (!address || typeof address === "string") throw new Error("Loopback fixture failed");

  endpoint = `http://127.0.0.1:${address.port}`;

  const bindings: Bindings = {
    DATABASE_URL: input.databaseUrl,
    BETTER_AUTH_SECRET: input.authSecret,
    BETTER_AUTH_URL: input.origin,
    OPENERP_PREPARATION_TOKEN: input.token,
    DOCUMENT_INSPECTOR: inspectQueuedDocument,
    DOCUMENT_READER: localDocumentReader(endpoint),
  };

  const login = await api.fetch(
    new Request(`${input.origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: input.origin },
      body: JSON.stringify({ email: input.email, password: input.password }),
    }),
    bindings,
  );

  if (!login.ok) throw new Error("Synthetic sign-in failed");

  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  const base = `${input.origin}/api/v1/entities/entity_synthetic/books/book_synthetic`;

  async function call<S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: Schema.JsonObject,
  ): Promise<S["Type"]> {
    const command = new Request(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin: input.origin,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const result =
      path === "/source-occurrences" ? await fetch(command) : await api.fetch(command, bindings);

    if (!result.ok)
      throw new Error(`Synthetic document boundary failed at ${path}: ${result.status}`);

    return Schema.decodeSync(Schema.fromJsonString(schema))(await result.text());
  }

  const source = await call("/source-occurrences", Source.SourceOccurrence, {
    sourceSystem: "document-intelligence-browser",
    sourceAccountId: "synthetic",
    occurrenceKey: crypto.randomUUID(),
    sourceRevision: "1",
    filename: "DRA-113 synthetic invoice.pdf",
    mediaType: "application/pdf",
    contentBase64: original.toString("base64"),
  });

  const readerBindings: Bindings = {
    ...bindings,
    EVIDENCE_STORE: {
      async get(key) {
        if (key !== `v1/book_synthetic/${source.sha256.slice(7)}`) return null;

        const response = await fetch(`${base}/source-occurrences/${source.id}`, {
          headers: { cookie, origin: input.origin },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) throw new Error("Retained synthetic original is unavailable");

        const retained = Schema.decodeSync(Schema.fromJsonString(Source.SourceOccurrenceView))(
          await response.text(),
        );

        if (
          retained.occurrence.id !== source.id ||
          retained.occurrence.sha256 !== source.sha256 ||
          retained.occurrence.scope.bookId !== "book_synthetic"
        )
          throw new Error("Retained synthetic source identity changed");

        return new Uint8Array(Buffer.from(retained.contentBase64, "base64"));
      },
      async put() {
        throw new Error("The synthetic extraction reader cannot replace retained originals");
      },
    },
  };

  await call("/commerce/supplier-inbox", Inbox.SupplierInboxView, {
    occurrenceId: source.id,
    channel: "upload",
    messageIdentity: null,
  });
  const path = `/commerce/supplier-inbox/${source.id}/extraction`;

  const admitted = await call(path, Extraction.SupplierExtractionRequestResult, {
    engineRelease: "azure-invoice-v1",
    pageSelection: "all",
    amountProfile: "sv-SE-SEK",
    dataUsePolicy: "retain_output",
  });

  const services = Layer.mergeAll(
    databaseLayer({
      connectionString: Redacted.make(input.databaseUrl),
      applicationName: "document-browser-seed",
      connectTimeoutMs: 5000,
      statementTimeoutMs: 15000,
    }),
    Layer.succeed(RequestEnvironment, { bindings: readerBindings, url: origin }),
  );

  await Effect.runPromise(
    runSupplierExtraction(
      { entityId: "entity_synthetic", bookId: "book_synthetic" },
      admitted.request.id,
    ).pipe(Effect.provide(services)),
  );
  const state = await call(path, Extraction.SupplierExtractionState);

  if (state.attempt?.result !== "succeeded" || submissions !== 1)
    throw new Error("Synthetic retained reading did not complete");

  await writeFile(join(input.output, "document-intelligence-original.pdf"), original);
  await writeFile(
    join(input.output, "document-intelligence-fixture.json"),
    JSON.stringify(
      {
        synthetic: true,
        source,
        state,
        expectedNumber: "DOC-113",
        expectedTotal: "1250,00 SEK",
        submissions,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise<void>((done) => provider.close(() => done()));
}
