import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdtemp, appendFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as Schema from "effect/Schema";
import * as Contracts from "@open-erp/contracts/peppol-exchange";

const Controls = Schema.Struct({
  loseSubmit: Schema.optional(Schema.Boolean),
  rejectSubmit: Schema.optional(Schema.Boolean),
  status: Schema.optional(Contracts.ProviderOutcome.fields.outcome),
  validatorFault: Schema.optional(
    Schema.Literals(["absent_engine", "changed_rule", "changed_release"]),
  ),
  corruptOutcome: Schema.optional(Schema.Literals(["buyer", "hash", "document"])),
  validationCorruption: Schema.optional(Schema.Literals(["buyer", "tax", "original_reference"])),
});

const FixtureInput = Schema.Struct({
  controls: Schema.optional(Controls),
  envelope: Schema.optional(Contracts.Envelope),
});

export async function startPeppolFixture(settings: {
  readonly python: string;
  readonly validatorPath: string;
  readonly releaseSha256: string;
}) {
  const secret = randomBytes(32).toString("hex");
  const controls = new Map<string, typeof Controls.Type>();
  const envelopes = new Map<string, typeof Contracts.Envelope.Type>();

  const messages = new Map<
    string,
    {
      readonly message: typeof Contracts.ProviderMessage.Type;
      readonly outcome: typeof Contracts.ProviderOutcome.Type;
    }
  >();

  const pendingMessages = new Map<
    string,
    {
      readonly message: typeof Contracts.ProviderMessage.Type;
      readonly validation: Promise<typeof Contracts.ValidationReport.Type>;
    }
  >();

  const validationRuns: Array<typeof Contracts.ValidationReport.Type> = [];
  const children = new Set<ReturnType<typeof spawn>>();
  const scratch = await mkdtemp(join(tmpdir(), "openerp-peppol-ap-"));
  let modifiedValidator: string | undefined;
  let closed = false;

  async function validate(
    input: typeof Contracts.ValidationRequest.Type,
    control?: typeof Controls.Type,
  ): Promise<typeof Contracts.ValidationReport.Type> {
    let validatorPath = settings.validatorPath;

    if (control?.validatorFault === "changed_rule") {
      if (modifiedValidator === undefined) {
        const destination = join(scratch, "modified");
        await cp(dirname(settings.validatorPath), destination, {
          recursive: true,
          filter: (source) => !source.includes("/.venv"),
        });
        await appendFile(join(destination, "vendor/rules/PEPPOL-EN16931-UBL.sch"), "\n ");
        modifiedValidator = join(destination, "validate.py");
      }

      validatorPath = modifiedValidator;
    }

    let xml = input.xml;

    if (control?.validationCorruption === "buyer")
      xml = xml.replace(
        `>${input.expected.buyerParticipant}</cbc:EndpointID>`,
        ">5560000027</cbc:EndpointID>",
      );

    if (control?.validationCorruption === "tax")
      xml = xml.replace(/(<cbc:TaxAmount currencyID="SEK">)[0-9]+\.[0-9]{2}/, "$1999.99");

    if (control?.validationCorruption === "original_reference")
      xml = xml.replace(
        "</cbc:BuyerReference>",
        "</cbc:BuyerReference><cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>SYNTHETIC-WRONG-REFERENCE</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>",
      );

    const request = {
      ...input,
      xml,
      releaseSha256:
        control?.validatorFault === "changed_release" ? "0".repeat(64) : input.releaseSha256,
    };

    if (closed) return { outcome: "ValidationUnavailable", diagnostics: [] };

    return new Promise((resolve) => {
      const child = spawn(
        control?.validatorFault === "absent_engine"
          ? join(scratch, "absent-python")
          : settings.python,
        [validatorPath],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      children.add(child);
      const output: Buffer[] = [];
      let bytes = 0;
      let settled = false;

      const finish = (report: typeof Contracts.ValidationReport.Type) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (child.exitCode === null && child.signalCode === null && child.pid !== undefined)
          child.kill("SIGKILL");
        validationRuns.push(report);
        resolve(report);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ outcome: "ValidationUnavailable", diagnostics: [] });
      }, 20000);

      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;

        if (bytes > 2097152) {
          child.kill("SIGKILL");
          finish({ outcome: "ValidationUnavailable", diagnostics: [] });
        } else output.push(chunk);
      });
      child.stderr.resume();
      child.once("error", () => finish({ outcome: "ValidationUnavailable", diagnostics: [] }));
      child.once("close", () => {
        children.delete(child);

        try {
          finish(
            Schema.decodeSync(Schema.fromJsonString(Contracts.ValidationReport))(
              new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(output)),
              {
                onExcessProperty: "error",
              },
            ),
          );
        } catch {
          finish({ outcome: "ValidationUnavailable", diagnostics: [] });
        }
      });
      child.stdin.on("error", () => finish({ outcome: "ValidationUnavailable", diagnostics: [] }));
      child.stdin.end(JSON.stringify(request));
    });
  }

  const server = createServer((request, response) => {
    const handle = async () => {
      if (request.headers.authorization !== `Bearer ${secret}`) {
        response.writeHead(401).end();

        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const inputChunks: Buffer[] = [];
      let bytes = 0;

      for await (const chunk of request) {
        bytes += chunk.byteLength;

        if (bytes > 2097152) {
          response.writeHead(413).end();

          return;
        }

        inputChunks.push(Buffer.from(chunk));
      }

      const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(inputChunks));

      const send = (status: number, value: unknown) =>
        response
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify(value));

      if (request.method === "PUT" && url.pathname.startsWith("/fixtures/")) {
        const id = decodeURIComponent(url.pathname.slice("/fixtures/".length));

        const input = Schema.decodeSync(Schema.fromJsonString(FixtureInput))(body, {
          onExcessProperty: "error",
        });

        if (input.controls) controls.set(id, input.controls);

        if (input.envelope) envelopes.set(id, input.envelope);
        send(200, { retained: true });

        return;
      }

      if (request.method === "GET" && url.pathname === "/inventory") {
        send(200, { messages: [...messages.values()], validationRuns });

        return;
      }

      if (request.method === "POST" && url.pathname === "/validate") {
        const input = Schema.decodeSync(Schema.fromJsonString(Contracts.ValidationRequest))(body, {
          onExcessProperty: "error",
        });

        send(200, await validate(input, controls.get(input.expected.documentId)));

        return;
      }

      if (request.method === "POST" && url.pathname === "/messages") {
        const input = Schema.decodeSync(Schema.fromJsonString(Contracts.ProviderMessage))(body, {
          onExcessProperty: "error",
        });

        const prior = messages.get(input.providerKey);

        if (prior) {
          if (JSON.stringify(prior.message) !== JSON.stringify(input)) {
            send(409, { code: "IntegrityIncident" });

            return;
          }

          send(200, prior.outcome);

          return;
        }

        const pending = pendingMessages.get(input.providerKey);

        if (pending) {
          if (JSON.stringify(pending.message) !== JSON.stringify(input)) {
            send(409, { code: "IntegrityIncident" });

            return;
          }

          await pending.validation;
          const completed = messages.get(input.providerKey);

          if (!completed) send(503, { code: "Unavailable" });
          else send(200, completed.outcome);

          return;
        }

        if (
          createHash("sha256").update(input.xml).digest("hex") !== input.documentHash ||
          input.releaseSha256 !== settings.releaseSha256 ||
          input.recipientParticipant !== input.expected.buyerParticipant ||
          input.senderParticipant !== input.expected.sellerParticipant ||
          input.documentId !== input.expected.documentId
        ) {
          send(422, { code: "SemanticMismatch" });

          return;
        }

        const control = controls.get(input.documentId);

        if (control?.rejectSubmit) {
          send(503, { code: "Unavailable" });

          return;
        }

        const validation = validate(
          { xml: input.xml, expected: input.expected, releaseSha256: input.releaseSha256 },
          control,
        ).catch((): typeof Contracts.ValidationReport.Type => ({
          outcome: "ValidationUnavailable",
          diagnostics: [],
        }));

        pendingMessages.set(input.providerKey, { message: input, validation });
        const report = await validation;

        if (report.outcome !== "passed") {
          pendingMessages.delete(input.providerKey);
          send(422, report);

          return;
        }

        const outcome: typeof Contracts.ProviderOutcome.Type = {
          providerAccount: "synthetic-ap-v1",
          providerKey: input.providerKey,
          externalMessageId: `ap_${input.providerKey}`,
          artifactId: input.artifactId,
          documentId: control?.corruptOutcome === "document" ? "other-document" : input.documentId,
          documentHash: control?.corruptOutcome === "hash" ? "0".repeat(64) : input.documentHash,
          senderParticipant: input.senderParticipant,
          recipientParticipant:
            control?.corruptOutcome === "buyer" ? "5560000027" : input.recipientParticipant,
          releaseSha256: input.releaseSha256,
          outcome: control?.status ?? "transport_accepted",
          observedAt: new Date().toISOString(),
        };

        messages.set(input.providerKey, { message: input, outcome });
        pendingMessages.delete(input.providerKey);

        if (control?.loseSubmit) {
          request.socket.destroy();

          return;
        }

        send(200, outcome);

        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/messages/")) {
        const key = decodeURIComponent(url.pathname.slice("/messages/".length));
        const pending = pendingMessages.get(key);

        if (pending) await pending.validation;
        const retained = messages.get(key);

        if (!retained) {
          send(200, {
            kind: "not_submitted",
            providerAccount: "synthetic-ap-v1",
            providerKey: key,
            observedAt: new Date().toISOString(),
          });

          return;
        }

        const control = controls.get(retained.message.documentId);
        send(200, {
          ...retained.outcome,
          outcome: control?.status ?? retained.outcome.outcome,
          observedAt: new Date().toISOString(),
        });

        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/inbound/")) {
        const envelope = envelopes.get(decodeURIComponent(url.pathname.slice("/inbound/".length)));

        if (!envelope) {
          send(404, { code: "NotFound" });

          return;
        }

        send(200, envelope);

        return;
      }

      send(404, { code: "NotFound" });
    };

    handle().catch(() => {
      if (!response.headersSent) response.writeHead(400).end();
      else response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("Peppol fixture needs a loopback port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    secret,
    providerAccount: "synthetic-ap-v1" as const,
    releaseSha256: settings.releaseSha256,
    async close() {
      closed = true;
      await Promise.all(
        [...children].map(
          (child) =>
            new Promise<void>((resolve) => {
              child.once("close", () => resolve());
              child.kill("SIGKILL");
            }),
        ),
      );
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(scratch, { recursive: true, force: true });
    },
  };
}
