import { documentSelfHost } from "./support/document-self-host";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as SupplierDrafts from "@open-erp/contracts/supplier-invoice-drafts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as Schema from "effect/Schema";
import { PDFDocument } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Source from "@open-erp/contracts/source-intake";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import * as Extraction from "@open-erp/contracts/supplier-extraction";
import {
  apiDirectory,
  createSession,
  database,
  decoded,
  environment,
  evidence,
  failure,
  fixture,
  key,
  post,
  request,
  run,
  type BookFixture,
} from "./support/fixtures";

async function original(
  book: BookFixture,
  bytes: Uint8Array,
  mediaType: "text/csv" | "application/pdf",
) {
  const source = await post(
    book,
    "/source-occurrences",
    {
      sourceSystem: "document-reader-e2e",
      sourceAccountId: "synthetic",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "synthetic-invoice",
      mediaType,
      contentBase64: Buffer.from(bytes).toString("base64"),
    },
    Source.SourceOccurrence,
  );

  await post(
    book,
    "/commerce/supplier-inbox",
    {
      occurrenceId: source.id,
      channel: "upload",
      messageIdentity: null,
    },
    Inbox.SupplierInboxView,
  );

  return source;
}

async function executeReading(book: BookFixture, requestId: string) {
  const path = join(environment().scratch, `${requestId}.json`);
  await writeFile(
    path,
    JSON.stringify({
      action: "run",
      scope: { entityId: book.entityId, bookId: book.bookId },
      requestId,
    }),
  );

  return run("bun", ["tests/support/document-reader-runner.ts", path], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: environment().runtimeUrl,
      OPENERP_PREPARATION_TOKEN: book.agentToken,
    },
  });
}

test("retains native extraction, diagnostics and replay through the public state resource", async () => {
  const base = await fixture();
  const book = { ...base, token: (await createSession(base)).token };

  const bytes = new TextEncoder().encode(
    "invoice_number: SYNTHETIC-1\ninvoice_date: 2026-09-27\ntotal_including_vat: 1250.00\n",
  );

  const source = await original(book, bytes, "text/csv");
  const path = `/commerce/supplier-inbox/${source.id}/extraction`;

  const admitted = await post(
    book,
    path,
    {
      engineRelease: "native-text-v1",
      dataUsePolicy: "retain_output",
      selectedPages: [{ page: 1, startByte: 0, endByte: bytes.byteLength }],
    },
    Extraction.SupplierExtractionRequestResult,
  );

  await executeReading(book, admitted.request.id);
  const first = await decoded(await request(book, path), Extraction.SupplierExtractionState);
  expect(
    first.attempt?.fields.find((field) => field.fieldKey === "sourceTotalMinor")?.proposedValue,
  ).toBe("125000");
  expect(first.attempt?.diagnostics).toBeDefined();
  await executeReading(book, admitted.request.id);
  const second = await decoded(await request(book, path), Extraction.SupplierExtractionState);
  expect(second.attempt).toEqual(first.attempt);

  const diagnosticsOnly = await post(
    book,
    path,
    {
      engineRelease: "native-text-v1",
      dataUsePolicy: "retain_diagnostics",
      selectedPages: [{ page: 1, startByte: 0, endByte: bytes.byteLength }],
    },
    Extraction.SupplierExtractionRequestResult,
  );

  await executeReading(book, diagnosticsOnly.request.id);
  const retained = await decoded(await request(book, path), Extraction.SupplierExtractionState);
  expect(retained.attempt?.fields).toEqual([]);
  expect(retained.attempt?.candidateLines).toEqual([]);

  await writeFile(
    join(environment().artifacts, "document-reader-native.json"),
    JSON.stringify(
      {
        synthetic: true,
        sourceHash: source.sha256,
        requestId: admitted.request.id,
        expectedTotalMinor: "125000",
        first,
        replay: second,
      },
      null,
      2,
    ),
  );
});

// HTTP simulator replaces only the external provider. API transport, retained
// filesystem bytes, restricted PostgreSQL role and the normal job handler are real.
async function documentFixture(
  mediaType: "application/pdf" | "image/png" = "application/pdf",
  pageCount = 2,
) {
  let submissions = 0;
  let polls = 0;
  let response: unknown = { status: "running" };
  let loseSubmission = false;
  let onPoll: (() => Promise<void>) | undefined;

  const providerErrors: unknown[] = [];

  const handle = async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    if (incoming.method === "POST") {
      submissions++;
      const chunks: Buffer[] = [];

      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));

      const body = Schema.decodeSync(
        Schema.fromJsonString(Schema.Struct({ base64Source: Schema.String })),
      )(Buffer.concat(chunks).toString());

      expect(Buffer.from(body.base64Source, "base64").subarray(0, 5).toString("hex")).toBe(
        mediaType === "application/pdf" ? "255044462d" : "89504e470d",
      );

      if (loseSubmission) {
        outgoing.destroy();

        return;
      }

      outgoing.writeHead(202, {
        "operation-location": `${endpoint}/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/synthetic-operation?api-version=2024-11-30`,
      });
      outgoing.end();
    } else {
      polls++;
      await onPoll?.();
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(typeof response === "string" ? response : JSON.stringify(response));
    }
  };

  const server = createServer((incoming, outgoing) => {
    void handle(incoming, outgoing).catch((error) => {
      providerErrors.push(error);
      outgoing.destroy();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("No fixture port");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const base = await fixture();
  const book = { ...base, token: (await createSession(base)).token };

  const invoke = async (input: Schema.JsonObject, enabled = true) => {
    const path = join(environment().scratch, `${key()}.json`);
    await writeFile(path, JSON.stringify(input));

    const output = await run("bun", ["tests/support/document-reader-runner.ts", path], {
      cwd: apiDirectory,
      env: {
        ...process.env,
        DATABASE_URL: environment().runtimeUrl,
        EVIDENCE_STORE_ROOT: join(environment().scratch, "document-objects"),
        DOCUMENT_READER_FIXTURE: enabled ? endpoint : "",
        OPENERP_PREPARATION_TOKEN: base.token,
      },
    });

    return output.stdout;
  };

  const apiCall = async (path: string, body?: Schema.JsonObject, enabled = true) => {
    const result = Schema.decodeSync(
      Schema.fromJsonString(Schema.Struct({ status: Schema.Int, body: Schema.String })),
    )(
      await invoke(
        {
          action: "api",
          path: book.path + path,
          token: book.token,
          method: body ? "POST" : "GET",
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        enabled,
      ),
    );

    return new Response(result.body, { status: result.status });
  };

  const pdf = await PDFDocument.create();

  for (let page = 0; page < pageCount; page++) {
    const sheet = pdf.addPage();
    sheet.drawText(page === 0 ? "SYNTHETIC-1" : "Second page", { x: 50, y: 700 });

    if (page === 0) sheet.drawText("1250,00 SEK", { x: 50, y: 650 });
  }

  const bytes =
    mediaType === "application/pdf"
      ? await pdf.save()
      : Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=",
          "base64",
        );

  const source = await decoded(
    await apiCall("/source-occurrences", {
      sourceSystem: "document-reader-e2e",
      sourceAccountId: "synthetic",
      occurrenceKey: key(),
      sourceRevision: "1",
      filename: "synthetic-two-pages.pdf",
      mediaType,
      contentBase64: Buffer.from(bytes).toString("base64"),
    }),
    Source.SourceOccurrence,
  );

  await decoded(
    await apiCall("/commerce/supplier-inbox", {
      occurrenceId: source.id,
      channel: "upload",
      messageIdentity: null,
    }),
    Inbox.SupplierInboxView,
  );
  const path = `/commerce/supplier-inbox/${source.id}/extraction`;

  return {
    book,
    runnerToken: base.token,
    bytes,
    source,
    apiCall,
    path,
    endpoint,
    counts: () => {
      expect(providerErrors).toEqual([]);

      return { submissions, polls };
    },
    setRawResponse: (value: string) => {
      response = value;
    },
    setResponse: (value: Schema.JsonObject) => {
      response = value;
    },
    onPoll: (callback: () => Promise<void>) => {
      onPoll = callback;
    },
    loseSubmission: () => {
      loseSubmission = true;
    },
    run: (requestId: string, queue = false) =>
      invoke({
        action: queue ? "queue" : "run",
        scope: { entityId: book.entityId, bookId: book.bookId },
        requestId,
      }),
    request: async () => decoded(await apiResponse(), Extraction.SupplierExtractionRequestResult),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };

  async function apiResponse() {
    return apiCall(path, {
      engineRelease: "azure-invoice-v1",
      pageSelection: "all",
      amountProfile: "sv-SE-SEK",
      dataUsePolicy: "retain_output",
    });
  }
}

function invoiceResponse(pages: number[] = [1, 2]) {
  const content = "SYNTHETIC-1\n1250,00 SEK\nSecond page";

  return {
    status: "succeeded",
    analyzeResult: {
      apiVersion: "2024-11-30",
      modelId: "prebuilt-invoice",
      stringIndexType: "utf16CodeUnit",
      content,
      pages: pages.map((pageNumber) => ({
        pageNumber,
        spans: [{ offset: pageNumber === 1 ? 0 : 24, length: pageNumber === 1 ? 23 : 11 }],
      })),
      documents: [
        {
          docType: "prebuilt:invoice",
          fields: {
            InvoiceId: {
              content: "SYNTHETIC-1",
              spans: [{ offset: 0, length: 11 }],
              boundingRegions: [{ pageNumber: 1 }],
            },
            InvoiceTotal: {
              content: "1250,00 SEK",
              valueCurrency: { amount: 999999 },
              spans: [{ offset: 12, length: 11 }],
              boundingRegions: [{ pageNumber: 1 }],
            },
          },
        },
      ],
    },
  };
}

test(
  "PDF reading retains page evidence, resumes polling and never repeats submission",
  { timeout: 240000 },
  async () => {
    const local = await documentFixture();

    try {
      const admitted = await local.request();
      await local.run(admitted.request.id);
      expect(local.counts()).toEqual({ submissions: 1, polls: 1 });
      local.setResponse(invoiceResponse());
      await local.run(admitted.request.id);

      const state = await decoded(
        await local.apiCall(local.path),
        Extraction.SupplierExtractionState,
      );

      expect(state.attempt?.result).toBe("succeeded");
      expect(state.attempt?.document?.coverage).toBe("complete");
      expect(
        state.attempt?.fields.find((field) => field.fieldKey === "sourceTotalMinor")?.proposedValue,
      ).toBe("125000");
      expect(state.attempt?.fields[0]?.sourceLocators[0]).toMatchObject({
        kind: "document_quote",
        page: 1,
        quote: "SYNTHETIC-1",
      });
      await local.run(admitted.request.id);
      expect(local.counts()).toEqual({ submissions: 1, polls: 2 });

      const prepared = await decoded(
        await local.apiCall(`${local.path}/${admitted.request.id}/prepare`, {
          attemptId: state.attempt!.attemptId,
        }),
        Extraction.SupplierExtractionReviewPreparation,
      );

      expect(prepared.fields.some((field) => field.suggestion === "125000")).toBe(true);
      expect(prepared.draft.state).toBe("absent");
      const support = await evidence(local.book);

      const counterparty = await post(
        local.book,
        "/commerce/counterparties",
        {
          kind: "synthetic_counterparty_v1",
          externalKey: key(),
          role: "supplier",
          displayName: "Synthetic supplier",
          evidenceId: support.id,
          reason: "Document reading fixture",
        },
        Commerce.CounterpartyRevision,
      );

      const identity = {
        legalName: "Synthetic identity",
        registrationId: null,
        taxId: null,
        address: null,
        countryCode: "SE",
        evidenceId: support.id,
      };

      const originalEvidence = await post(
        local.book,
        "/evidence",
        {
          title: "Reviewed original reference",
          content: JSON.stringify({
            source: { occurrenceId: local.source.id, sha256: local.source.sha256 },
          }),
          mediaType: "application/json",
          origin: "Synthetic reviewed document",
        },
        Accounting.Evidence,
      );

      const baseContent = {
        title: "Human reviewed synthetic invoice",
        counterpartyId: counterparty.id,
        counterpartyRevision: counterparty.revision,
        supplier: identity,
        buyer: identity,
        sourceEvidenceId: originalEvidence.id,
        supplierDocumentNumber: null,
        currency: "SEK",
        currencyScale: 2,
        documentDate: null,
        supplyDate: null,
        dueDate: null,
        paymentTerms: null,
        sourceTotalMinor: null,
        lines: [
          {
            id: "reviewed_line_one",
            description: "Manually supplied item",
            quantity: "1",
            unitPriceMinor: "100000",
            baseMinor: "100000",
            discountMinor: "0",
            chargeMinor: "0",
            taxMinor: "25000",
            taxDescription: "Synthetic reviewed VAT",
            taxEvidenceId: support.id,
            sourceGrossMinor: "125000",
          },
        ],
      };

      const created = await decoded(
        await local.apiCall(`${local.path}/${admitted.request.id}/review`, {
          requestId: admitted.request.id,
          attemptId: state.attempt!.attemptId,
          expectedDraftRevision: null,
          expectedDraftDigest: null,
          baseContent,
          reason: "Human accepts printed number and total",
          lines: [],
          fields: [
            {
              lineOrdinal: 0,
              fieldKey: "supplierDocumentNumber",
              decisionKind: "accepted_suggestion",
              selectedValue: "SYNTHETIC-1",
            },
            {
              lineOrdinal: 0,
              fieldKey: "sourceTotalMinor",
              decisionKind: "accepted_suggestion",
              selectedValue: "125000",
            },
          ],
        }),
        Extraction.SupplierExtractionReview,
      );

      expect(created.outcome).toBe("draft_created");
      expect(created.draft?.content.sourceTotalMinor).toBe("125000");
      const next = await local.request();
      const current = created.draft!;

      const edited = await post(
        local.book,
        `/commerce/supplier-invoice-drafts/${current.id}/revisions`,
        {
          expectedRevision: current.revision,
          expectedDigest: current.digest,
          reason: "Human corrects the document number while reading is pending",
          content: { ...current.content, supplierDocumentNumber: "HUMAN-CORRECTION" },
        },
        SupplierDrafts.SupplierInvoiceDraftRevision,
      );

      await local.run(next.request.id);

      const nextState = await decoded(
        await local.apiCall(local.path),
        Extraction.SupplierExtractionState,
      );

      const conflict = await decoded(
        await local.apiCall(`${local.path}/${next.request.id}/prepare`, {
          attemptId: nextState.attempt!.attemptId,
        }),
        Extraction.SupplierExtractionReviewPreparation,
      );

      expect(
        conflict.fields.find((field) => field.fieldKey === "supplierDocumentNumber")?.selected,
      ).toBe("HUMAN-CORRECTION");

      const after = await decoded(
        await request(local.book, `/commerce/supplier-invoice-drafts/${current.id}`),
        SupplierDrafts.SupplierInvoiceDraftView,
      );

      expect(after.currentDigest).toBe(edited.digest);

      const inboxList = await decoded(
        await local.apiCall("/commerce/supplier-inbox"),
        Inbox.SupplierInboxPage,
      );

      expect(inboxList.items[0]?.occurrence.occurrence.id).toBe(local.source.id);

      const draftList = await decoded(
        await local.apiCall("/commerce/supplier-invoice-drafts"),
        SupplierDrafts.SupplierInvoiceDraftList,
      );

      expect(draftList.items[0]?.grossMinor).toBe("125000");

      await writeFile(
        join(environment().artifacts, "document-reader-review.json"),
        JSON.stringify({ created, edited, conflict, after }, null, 2),
      );

      if (process.env.DOCUMENT_BROWSER_PROOF === "1") {
        const ready = join(environment().artifacts, "document-reader-browser.json");
        const done = join(environment().artifacts, "document-reader-browser.done");

        const child = spawn("bun", ["tests/support/document-reader-browser.ts"], {
          cwd: apiDirectory,
          stdio: "ignore",
          env: {
            ...process.env,
            DATABASE_URL: environment().runtimeUrl,
            FIXTURE_SESSION: local.book.token,
            EVIDENCE_STORE_ROOT: join(environment().scratch, "document-objects"),
            DOCUMENT_READER_FIXTURE: local.endpoint,
            FIXTURE_READY: ready,
            FIXTURE_DESTINATION: `/entities/${local.book.entityId}/books/${local.book.bookId}/purchases`,
          },
        });

        try {
          const deadline = Date.now() + 180000;
          let observed = false;

          while (Date.now() < deadline) {
            observed = await access(done).then(
              () => true,
              () => false,
            );

            if (observed) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          expect(
            observed,
            "Complete the browser walkthrough and retain its observation receipt.",
          ).toBe(true);
        } finally {
          child.kill("SIGTERM");
        }
      }

      await writeFile(
        join(environment().artifacts, "document-reader-pdf.json"),
        JSON.stringify(
          { synthetic: true, liveProvider: false, state, prepared, ...local.counts() },
          null,
          2,
        ),
      );
    } finally {
      await local.close();
    }
  },
);

test("partial coverage remains visible and a lost submission is never sent again", async () => {
  const local = await documentFixture();

  try {
    local.setResponse(invoiceResponse([1]));
    const first = await local.request();
    await local.run(first.request.id);

    const state = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(state.attempt?.document?.coverage).toBe("partial");
    expect(state.attempt?.diagnostics.some((entry) => entry.code === "missing_pages")).toBe(true);
    local.loseSubmission();
    const second = await local.request();
    await local.run(second.request.id);
    await local.run(second.request.id);

    const unknown = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(unknown.attempt?.result).toBe("unknown");
    expect(local.counts().submissions).toBe(2);
  } finally {
    await local.close();
  }
});

test("disabled reading, invalid quotes and cancellation cannot create usable suggestions", async () => {
  const local = await documentFixture();

  try {
    await failure(
      await local.apiCall(
        local.path,
        {
          engineRelease: "azure-invoice-v1",
          pageSelection: "all",
          amountProfile: "sv-SE-SEK",
          dataUsePolicy: "retain_output",
        },
        false,
      ),
      503,
      "Unavailable",
    );
    expect(local.counts().submissions).toBe(0);
    const wrong = invoiceResponse();
    wrong.analyzeResult.documents[0]!.fields.InvoiceTotal.content = "9999,99 SEK";
    local.setResponse(wrong);
    const rejected = await local.request();
    await local.run(rejected.request.id);

    const state = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(state.attempt?.result).toBe("rejected_output");
    expect(state.attempt?.fields).toEqual([]);
    const cancelled = await local.request();
    await decoded(
      await local.apiCall(`${local.path}/${cancelled.request.id}/cancel`, {
        requestId: cancelled.request.id,
      }),
      Extraction.SupplierExtractionCancelResult,
    );
    await local.run(cancelled.request.id);
    expect(local.counts().submissions).toBe(1);
  } finally {
    await local.close();
  }
});

test("single images retain sparse lines and originals beyond the page cap are not disclosed", async () => {
  const image = await documentFixture("image/png", 1);

  try {
    const reading = invoiceResponse([1]);
    const invoice = reading.analyzeResult.documents[0]!;
    image.setResponse({
      ...reading,
      analyzeResult: {
        ...reading.analyzeResult,
        documents: [
          {
            ...invoice,
            fields: {
              ...invoice.fields,
              Items: { valueArray: [{ valueObject: { Description: invoice.fields.InvoiceId } }] },
            },
          },
        ],
      },
    });
    const admitted = await image.request();
    await image.run(admitted.request.id);

    const state = await decoded(
      await image.apiCall(image.path),
      Extraction.SupplierExtractionState,
    );

    expect(state.attempt?.document?.physicalPages).toBe(1);
    expect(state.attempt?.document?.coverage).toBe("complete");
    expect(state.attempt?.candidateLines[0]?.fields.map((field) => field.fieldKey)).toEqual([
      "description",
    ]);
    expect(state.attempt?.candidateLines[0]?.content).toBeUndefined();
  } finally {
    await image.close();
  }

  const large = await documentFixture("application/pdf", 21);

  try {
    const admitted = await large.request();
    await large.run(admitted.request.id);

    const state = await decoded(
      await large.apiCall(large.path),
      Extraction.SupplierExtractionState,
    );

    expect(state.attempt?.result).toBe("failed");
    expect(large.counts().submissions).toBe(0);
  } finally {
    await large.close();
  }
});

test("cancelling during a provider response fences the late result", async () => {
  const local = await documentFixture();

  try {
    local.setResponse(invoiceResponse());
    const admitted = await local.request();
    local.onPoll(async () => {
      await decoded(
        await local.apiCall(`${local.path}/${admitted.request.id}/cancel`, {
          requestId: admitted.request.id,
        }),
        Extraction.SupplierExtractionCancelResult,
      );
    });
    await local.run(admitted.request.id);

    const state = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(state.requests[0]?.state).toBe("cancelled");
    expect(state.attempt).toBeNull();
  } finally {
    await local.close();
  }
});

test("ambiguous JSON and provider failures remain failed readings", async () => {
  const local = await documentFixture();

  try {
    local.setRawResponse('{"status":"running","status":"succeeded"}');
    const first = await local.request();
    await local.run(first.request.id);

    const rejected = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(rejected.attempt?.result).toBe("rejected_output");
    local.setResponse({ status: "failed" });
    const second = await local.request();
    await local.run(second.request.id);

    const failed = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(failed.attempt?.diagnostics[0]?.code).toBe("provider_failed");
    expect(local.counts().submissions).toBe(2);
  } finally {
    await local.close();
  }
});

test("the durable queue polls a pending operation without repeating disclosure", async () => {
  const local = await documentFixture();

  try {
    const admitted = await local.request();
    local.onPoll(() => {
      if (local.counts().polls === 2) local.setResponse(invoiceResponse());

      return Promise.resolve();
    });
    await local.run(admitted.request.id, true);

    const state = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(state.attempt?.result).toBe("succeeded");
    expect(local.counts()).toEqual({ submissions: 1, polls: 2 });
    await writeFile(
      join(environment().artifacts, "document-reader-queue.json"),
      JSON.stringify({ synthetic: true, state, ...local.counts() }, null, 2),
    );
  } finally {
    await local.close();
  }
});

test(
  "normal self-host and preparation processes read retained originals end to end",
  { timeout: 360000 },
  async () => {
    const local = await documentFixture();

    const runtime = await documentSelfHost(
      local.endpoint,
      local.runnerToken,
      join(environment().scratch, "self-host-objects"),
    );

    const call = (path: string, body?: Schema.JsonObject) =>
      fetch(runtime.origin + local.book.path + path, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${local.book.token}`,
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

    try {
      const source = await decoded(
        await call("/source-occurrences", {
          sourceSystem: "self-host-document-e2e",
          sourceAccountId: "synthetic",
          occurrenceKey: key(),
          sourceRevision: "1",
          filename: "self-host-invoice.pdf",
          mediaType: "application/pdf",
          contentBase64: Buffer.from(local.bytes).toString("base64"),
        }),
        Source.SourceOccurrence,
      );

      await decoded(
        await call("/commerce/supplier-inbox", {
          occurrenceId: source.id,
          channel: "upload",
          messageIdentity: null,
        }),
        Inbox.SupplierInboxView,
      );
      const path = `/commerce/supplier-inbox/${source.id}/extraction`;
      await decoded(
        await call(path, {
          engineRelease: "azure-invoice-v1",
          pageSelection: "all",
          amountProfile: "sv-SE-SEK",
          dataUsePolicy: "retain_output",
        }),
        Extraction.SupplierExtractionRequestResult,
      );
      local.onPoll(() => {
        if (local.counts().polls === 2) local.setResponse(invoiceResponse());

        return Promise.resolve();
      });
      runtime.startWorker();
      let state = await decoded(await call(path), Extraction.SupplierExtractionState);
      const deadline = Date.now() + 60000;

      while (state.requests[0]?.state === "ready" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        state = await decoded(await call(path), Extraction.SupplierExtractionState);
      }

      expect(state.attempt?.result).toBe("succeeded");
      expect(state.attempt?.document?.physicalPages).toBe(2);
      expect(local.counts()).toEqual({ submissions: 1, polls: 2 });
      await writeFile(
        join(environment().artifacts, "document-reader-self-host.json"),
        JSON.stringify({ synthetic: true, liveProvider: false, state, ...local.counts() }, null, 2),
      );
      const support = await evidence(local.book);

      const counterparty = await decoded(
        await call("/commerce/counterparties", {
          kind: "synthetic_counterparty_v1",
          externalKey: key(),
          role: "supplier",
          displayName: "Synthetic supplier",
          evidenceId: support.id,
          reason: "Self-host journey fixture",
        }),
        Commerce.CounterpartyRevision,
      );

      if (process.env.DOCUMENT_SELF_HOST_BROWSER === "1") {
        const ready = join(environment().artifacts, "document-reader-self-host-browser.json");
        const done = join(environment().artifacts, "document-reader-self-host-browser.done");

        const child = spawn("bun", ["tests/support/document-reader-browser.ts"], {
          cwd: apiDirectory,
          stdio: "ignore",
          env: {
            ...process.env,
            DATABASE_URL: environment().runtimeUrl,
            FIXTURE_SESSION: local.book.token,
            EVIDENCE_STORE_ROOT: join(environment().scratch, "self-host-objects"),
            DOCUMENT_READER_FIXTURE: local.endpoint,
            FIXTURE_READY: ready,
            FIXTURE_DESTINATION: `${runtime.origin}/entities/${local.book.entityId}/books/${local.book.bookId}/purchases`,
          },
        });

        try {
          const until = Date.now() + 240000;
          let observed = false;

          while (Date.now() < until) {
            observed = await access(done).then(
              () => true,
              () => false,
            );

            if (observed) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          expect(observed, "Retain the self-host browser observation receipt").toBe(true);
        } finally {
          child.kill("SIGTERM");
        }
      } else {
        const originalEvidence = await decoded(
          await call("/evidence", {
            title: "Self-host original reference",
            mediaType: "application/json",
            origin: "Synthetic self-host review",
            content: JSON.stringify({ source: { occurrenceId: source.id, sha256: source.sha256 } }),
          }),
          Accounting.Evidence,
        );

        const identity = {
          legalName: "Synthetic identity",
          registrationId: null,
          taxId: null,
          address: null,
          countryCode: "SE",
          evidenceId: support.id,
        };

        await decoded(
          await call(`/commerce/supplier-inbox/${source.id}/review`, {
            reviewAttemptId: state.attempt!.attemptId,
            reviewReason: "Human checked source and completed missing facts",
            draft: {
              draftKey: `selfhost_${key().replaceAll("-", "")}`,
              content: {
                title: "Self-host reviewed invoice",
                counterpartyId: counterparty.id,
                counterpartyRevision: counterparty.revision,
                supplier: identity,
                buyer: identity,
                sourceEvidenceId: originalEvidence.id,
                supplierDocumentNumber: "SELF-HOST-REVIEWED",
                currency: "SEK",
                currencyScale: 2,
                documentDate: null,
                supplyDate: null,
                dueDate: null,
                paymentTerms: null,
                sourceTotalMinor: "125000",
                lines: [
                  {
                    id: "selfhost_line",
                    description: "Manually reviewed item",
                    quantity: "1",
                    unitPriceMinor: "100000",
                    baseMinor: "100000",
                    discountMinor: "0",
                    chargeMinor: "0",
                    taxMinor: "25000",
                    taxDescription: "Reviewed tax",
                    taxEvidenceId: support.id,
                    sourceGrossMinor: "125000",
                  },
                ],
              },
            },
          }),
          Inbox.SupplierInboxReview,
        );
      }

      const inbox = await decoded(
        await call(`/commerce/supplier-inbox/${source.id}`),
        Inbox.SupplierInboxView,
      );

      expect(inbox.draftId).not.toBeNull();
      expect(inbox.reviewAttemptId).toBe(state.attempt!.attemptId);

      const view = await decoded(
        await call(`/commerce/supplier-invoice-drafts/${inbox.draftId}`),
        SupplierDrafts.SupplierInvoiceDraftView,
      );

      const draft = view.record;

      expect(draft.content.supplierDocumentNumber).toBe("SELF-HOST-REVIEWED");
      expect(draft.content.sourceTotalMinor).toBe("125000");
      expect(draft.totals.grossMinor).toBe("125000");
      await writeFile(
        join(environment().artifacts, "document-reader-self-host-draft.json"),
        JSON.stringify({ synthetic: true, inbox, draft }, null, 2),
      );

      const retryRequest = await decoded(
        await call(path, {
          engineRelease: "azure-invoice-v1",
          pageSelection: "all",
          amountProfile: "sv-SE-SEK",
          dataUsePolicy: "retain_output",
        }),
        Extraction.SupplierExtractionRequestResult,
      );

      const admin = await database();

      try {
        await admin.query(
          "UPDATE openerp.books SET profile = 'unreleased-document-profile' WHERE id = $1",
          [local.book.bookId],
        );
        const until = Date.now() + 75000;
        let stopped = false;

        while (Date.now() < until) {
          const observed = await admin.query<{ state: string }>(
            "SELECT state FROM openerp.supplier_extraction_request_states WHERE book_id = $1 AND request_id = $2",
            [local.book.bookId, retryRequest.request.id],
          );

          stopped = observed.rows[0]?.state === "unknown";

          if (stopped) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        expect(stopped, "A non-retryable delivery must leave the dispatchable state").toBe(true);
        expect(local.counts()).toEqual({ submissions: 1, polls: 2 });
        await writeFile(
          join(environment().artifacts, "document-reader-terminal.json"),
          JSON.stringify(
            {
              synthetic: true,
              requestId: retryRequest.request.id,
              state: "unknown",
              ...local.counts(),
            },
            null,
            2,
          ),
        );
      } finally {
        await admin.query("UPDATE openerp.books SET profile = 'synthetic-core-v1' WHERE id = $1", [
          local.book.bookId,
        ]);
        await admin.end();
      }
    } finally {
      await runtime.close();
      await local.close();
    }
  },
);

test("self-host rejects external endpoints in local fixture mode before serving", async () => {
  await expect(
    run("bun", ["scripts/self-host.ts"], {
      cwd: apiDirectory,
      env: {
        ...process.env,
        DATABASE_URL: environment().runtimeUrl,
        BETTER_AUTH_SECRET: "synthetic-document-browser-proof-only-secret",
        OPENERP_PUBLIC_URL: "http://127.0.0.1:3000",
        OPENERP_DOCUMENT_READER: "local-azure-fixture",
        OPENERP_DOCUMENT_READER_ENDPOINT: "https://example.invalid",
      },
    }),
  ).rejects.toThrow("fixture must use HTTP on IPv4 loopback");
});

// An admitted document may not be disclosed by a revoked executor, nor may a
// result be published after revocation during polling. Retry resumes its receipt.
test("document reader rechecks executor authority without repeating disclosure", async () => {
  const local = await documentFixture();
  const admin = await database();
  const hash = createHash("sha256").update(local.runnerToken).digest("hex");

  const setRevoked = async (revoked: boolean) => {
    await admin.query(
      "UPDATE openerp.credentials SET revoked_at = CASE WHEN $2 THEN clock_timestamp() ELSE NULL END WHERE token_hash = $1",
      [hash, revoked],
    );
  };

  try {
    const admitted = await local.request();
    local.setResponse(invoiceResponse());
    await setRevoked(true);
    await expect(local.run(admitted.request.id)).rejects.toThrow();
    expect(local.counts()).toEqual({ submissions: 0, polls: 0 });
    await setRevoked(false);

    let revokedDuringPoll = false;
    local.onPoll(async () => {
      if (revokedDuringPoll) return;
      revokedDuringPoll = true;
      await setRevoked(true);
    });

    await expect(local.run(admitted.request.id)).rejects.toThrow();

    const refused = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(refused.attempt).toBeNull();
    expect(refused.requests[0]?.state).toBe("ready");
    expect(local.counts()).toEqual({ submissions: 1, polls: 1 });
    await setRevoked(false);
    await local.run(admitted.request.id);

    const completed = await decoded(
      await local.apiCall(local.path),
      Extraction.SupplierExtractionState,
    );

    expect(completed.attempt?.result).toBe("succeeded");
    expect(local.counts()).toEqual({ submissions: 1, polls: 2 });
    await writeFile(
      join(environment().artifacts, "document-reader-executor-revocation.json"),
      JSON.stringify(
        {
          synthetic: true,
          requestId: admitted.request.id,
          refused,
          completed,
          counts: local.counts(),
        },
        null,
        2,
      ),
    );
  } finally {
    await setRevoked(false);
    await admin.end();
    await local.close();
  }
});
