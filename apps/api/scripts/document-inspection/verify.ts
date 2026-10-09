import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import * as Schema from "effect/Schema";
import { PDFDocument, degrees } from "pdf-lib";
import {
  DocumentInspectionError,
  inspectDocument,
  inspectQueuedDocument,
  runIsolatedDocumentWorker,
} from "./inspection";

const execute = promisify(execFile);

const directory = await realpath(await mkdtemp(join(tmpdir(), "openerp-isolation-proof-")));

const output = resolve(
  process.env.OPENERP_DOCUMENT_PROOF ?? "test-results/document-intelligence/isolation.json",
);

const node = await realpath((await execute("/usr/bin/which", ["node"])).stdout.trim());

const observations: Array<{ case: string; expected: unknown; observed: unknown }> = [];

let requests = 0;

const server = createServer((_request, response) => {
  requests++;
  response.end("synthetic loopback fixture");
});

async function refuses(name: string, code: string, operation: () => Promise<unknown>) {
  let observed = "succeeded";

  try {
    await operation();
  } catch (error) {
    observed = error instanceof Error ? error.message : "unknown";
  }

  observations.push({ case: name, expected: code, observed });
  assert.equal(observed, code, name);
}

try {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();

  assert(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(endpoint)).status, 200);
  const secret = join(directory, "unrelated-secret.txt");

  await writeFile(secret, "synthetic canary", { mode: 0o600 });
  assert.equal(await readFile(secret, "utf8"), "synthetic canary");
  process.env.OPENERP_INSPECTION_CANARY = "synthetic environment canary";
  const probe = join(directory, "hostile.mjs");

  await writeFile(
    probe,
    `
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const input = JSON.parse(process.argv[2]);
async function denied(operation) { try { await operation(); return false; } catch { return true; } }
const result = {
  file: await denied(() => readFile(input.secret)),
  metadata: await denied(() => stat(input.secret)),
  environment: process.env.OPENERP_INSPECTION_CANARY === undefined,
  network: await denied(() => fetch(input.endpoint, { signal: AbortSignal.timeout(1000) })),
  child: await denied(() => execFileSync("/bin/echo", ["unexpected child"])),
};
process.stdout.write(JSON.stringify(result));
`,
  );

  const restricted = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({
        file: Schema.Boolean,
        metadata: Schema.Boolean,
        environment: Schema.Boolean,
        network: Schema.Boolean,
        child: Schema.Boolean,
      }),
    ),
  )(
    await runIsolatedDocumentWorker(
      probe,
      node,
      new Uint8Array(),
      JSON.stringify({ secret, endpoint }),
    ),
  );

  assert.deepEqual(restricted, {
    file: true,
    metadata: true,
    environment: true,
    network: true,
    child: true,
  });
  assert.equal(requests, 1);
  observations.push({
    case: "hostile boundary",
    expected: {
      file: true,
      metadata: true,
      environment: true,
      network: true,
      child: true,
      extraRequests: 0,
    },
    observed: { ...restricted, extraRequests: requests - 1 },
  });
  const pdf = await PDFDocument.create();

  pdf.addPage([300, 300]);
  const bytes = await pdf.save();
  const manifest = await inspectDocument(bytes, "application/pdf");

  assert.deepEqual(manifest, { unit: "inch", pages: [{ width: 300 / 72, height: 300 / 72 }] });
  observations.push({
    case: "retained PDF inspection",
    expected: 1,
    observed: manifest.pages.length,
  });
  const cropped = await PDFDocument.create();
  const croppedPage = cropped.addPage([300, 300]);

  croppedPage.setCropBox(20, 30, 200, 100);
  croppedPage.setRotation(degrees(90));
  assert.deepEqual(await inspectDocument(await cropped.save(), "application/pdf"), {
    unit: "inch",
    pages: [{ width: 100 / 72, height: 200 / 72 }],
  });
  observations.push({
    case: "cropped rotated PDF",
    expected: [100 / 72, 200 / 72],
    observed: [100 / 72, 200 / 72],
  });
  await refuses("oversize", "document_size", () =>
    inspectDocument(new Uint8Array(5 * 1024 * 1024 + 1), "application/pdf"),
  );
  await refuses("corrupt PDF", "document_invalid", () =>
    inspectDocument(new TextEncoder().encode("%PDF-broken"), "application/pdf"),
  );
  const large = await PDFDocument.create();

  for (let page = 0; page < 21; page++) large.addPage([300, 300]);
  const largeBytes = await large.save();

  await refuses("physical page cap", "page_limit", () =>
    inspectDocument(largeBytes, "application/pdf"),
  );
  const first = inspectDocument(bytes, "application/pdf");

  await refuses("concurrent capacity", "inspection_capacity", () =>
    inspectDocument(bytes, "application/pdf"),
  );
  await first;

  const queued = await Promise.allSettled(
    Array.from({ length: 9 }, () => inspectQueuedDocument(bytes, "application/pdf")),
  );

  assert.equal(queued.filter((result) => result.status === "fulfilled").length, 8);
  assert.equal(queued[8]?.status, "rejected");

  const overflow = queued[8];

  assert(overflow?.status === "rejected");
  assert(overflow.reason instanceof DocumentInspectionError);
  assert.equal(overflow.reason.message, "inspection_capacity");
  assert.deepEqual(await inspectQueuedDocument(bytes, "application/pdf"), manifest);
  observations.push({
    case: "bounded queued admission and release",
    expected: { completed: 8, overflow: "inspection_capacity", released: true },
    observed: {
      completed: queued.filter((result) => result.status === "fulfilled").length,
      overflow: overflow.reason.message,
      released: true,
    },
  });
  await writeFile(probe, "while (true) {}\n");
  await refuses("inspection deadline", "inspection_timeout", () =>
    runIsolatedDocumentWorker(probe, node, new Uint8Array(), ""),
  );
  await writeFile(
    probe,
    "const pages=[];setInterval(()=>pages.push(new Uint8Array(8*1024*1024).fill(1)),10);\n",
  );
  await refuses("resident memory threshold", "inspection_memory_limit", () =>
    runIsolatedDocumentWorker(probe, node, new Uint8Array(), ""),
  );
  await writeFile(probe, "process.stdout.write('x'.repeat(5000));\n");
  await refuses("worker output cap", "inspection_output_limit", () =>
    runIsolatedDocumentWorker(probe, node, new Uint8Array(), ""),
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        synthetic: true,
        platform: process.platform,
        status: "verified",
        memoryBoundary:
          "128 MiB JavaScript old-space; 256 MiB RSS threshold sampled every 50 ms, not a kernel RSS cap",
        observations,
      },
      null,
      2,
    ),
  );
  console.log(output);
} finally {
  delete process.env.OPENERP_INSPECTION_CANARY;
  await new Promise<void>((done) => server.close(() => done()));
  await rm(directory, { recursive: true, force: true });
}
