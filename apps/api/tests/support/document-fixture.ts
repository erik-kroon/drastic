import { createServer } from "node:http";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Documents from "@open-erp/contracts/document-signatures";
import * as Filing from "@open-erp/contracts/filing-lifecycle";

const Controls = Schema.Struct({
  loseStart: Schema.optional(Schema.Boolean),
  loseUpload: Schema.optional(Schema.Boolean),
  loseCollect: Schema.optional(Schema.Boolean),
  oversizedResponse: Schema.optional(Schema.Boolean),
  defect: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});

const SignRequest = Schema.Struct({
  intent: Documents.DocumentSignatureIntent,
  manifest: Documents.DocumentManifest,
  xhtml: Schema.String,
});

const FilingRequest = Schema.Struct({
  intent: Filing.FilingIntent,
  attempt: Filing.FilingAttempt,
  xhtml: Schema.optional(Schema.String),
});

type StreamedResponse = {
  state: "streaming" | "cancelled" | "complete";
  bytesSent: number;
};

export async function startDocumentFixture() {
  const secret = randomBytes(32).toString("hex");
  const serviceToken = randomBytes(32).toString("hex");
  const keyId = "synthetic_ed25519_1";
  const keys = generateKeyPairSync("ed25519");
  const exported = keys.publicKey.export({ format: "der", type: "spki" });
  const publicKey = exported.subarray(exported.length - 32).toString("base64");
  const controls = new Map<string, typeof Controls.Type>();
  const signatures = new Map<string, typeof Documents.SignatureProviderResult.Type>();
  const streamedResponses = new Map<string, StreamedResponse>();

  const filings = new Map<
    string,
    {
      intent: typeof Filing.FilingIntent.Type;
      attempt: typeof Filing.FilingAttempt.Type;
      status: string;
    }
  >();

  function signed(payload: Schema.JsonObject) {
    const canonical = canonicalizeJson(payload);

    if (Result.isFailure(canonical)) throw new Error("Non-canonical fixture payload");

    return sign(null, canonical.success.bytes, keys.privateKey).toString("base64");
  }

  const server = createServer((request, response) => {
    const handle = async () => {
      if (request.headers.authorization !== `Bearer ${secret}`) {
        response.writeHead(401).end();

        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      let body = "";

      for await (const chunk of request) {
        body += chunk.toString();

        if (Buffer.byteLength(body) > 2500000) throw new Error("Fixture body exceeds bound");
      }

      const send = (value: unknown) =>
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));

      const sendResult = async (value: unknown, correlation: string) => {
        const control = controls.get(correlation);

        if (!control?.oversizedResponse) {
          send(value);

          return;
        }

        controls.set(correlation, { ...control, oversizedResponse: false });
        const retained: StreamedResponse = { state: "streaming", bytesSent: 0 };
        streamedResponses.set(correlation, retained);
        response.once("close", () => {
          if (retained.state !== "complete") retained.state = "cancelled";
        });
        response.writeHead(200, { "content-type": "application/json" });
        const prefix = `${JSON.stringify(value).slice(0, -1)},"padding":"`;
        response.write(prefix);
        retained.bytesSent += Buffer.byteLength(prefix);

        for (let chunk = 0; chunk < 32; chunk++) {
          if (response.destroyed) return;
          response.write("x".repeat(32768));
          retained.bytesSent += 32768;
          await new Promise<void>((resolve) => setTimeout(resolve, 8));
        }

        if (response.destroyed) return;
        retained.state = "complete";
        response.end('"}');
      };

      if (request.method === "GET" && url.pathname.startsWith("/response-inspect/")) {
        const correlation = decodeURIComponent(url.pathname.slice("/response-inspect/".length));
        send(streamedResponses.get(correlation) ?? { state: "not_started", bytesSent: 0 });

        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/inspect/")) {
        const correlation = decodeURIComponent(url.pathname.slice("/inspect/".length));
        send({
          signatureOrders: signatures.has(correlation) ? 1 : 0,
          filingUploads: filings.has(correlation) ? 1 : 0,
        });

        return;
      }

      if (request.method === "PUT" && url.pathname.startsWith("/fixtures/")) {
        const correlation = decodeURIComponent(url.pathname.slice("/fixtures/".length));
        controls.set(correlation, Schema.decodeSync(Schema.fromJsonString(Controls))(body));
        send({ retained: true });

        return;
      }

      if (request.method === "POST" && url.pathname === "/signatures") {
        const { intent, manifest, xhtml } = Schema.decodeSync(Schema.fromJsonString(SignRequest))(
          body,
        );

        if (
          intent.manifestDigest !== manifest.digest ||
          !xhtml.startsWith("<html") ||
          !manifest.consentText
        )
          throw new Error("Exact visible signing document required");
        const control = controls.get(intent.correlation);

        const payload: typeof Documents.SignaturePayload.Type = {
          profile: "synthetic-ed25519-v1",
          intentId: intent.id,
          manifestDigest:
            control?.defect === "wrong_digest" ? `sha256:${"0".repeat(64)}` : intent.manifestDigest,
          signerId: control?.defect === "wrong_signer" ? "other_signer" : intent.signerId,
          purpose: intent.purpose,
          consentTextHash: intent.consentTextHash,
          environment: control?.defect === "wrong_environment" ? "production" : intent.environment,
          correlation: intent.correlation,
          orderRef:
            control?.defect === "wrong_order" ? "other_order" : `order_${intent.correlation}`,
        };

        const result: typeof Documents.SignatureProviderResult.Type = {
          status: "complete",
          keyId: control?.defect === "wrong_key" ? "other_key" : keyId,
          payload,
          signature:
            control?.defect === "bad_signature"
              ? randomBytes(64).toString("base64")
              : signed(payload),
        };

        if (!signatures.has(intent.correlation)) signatures.set(intent.correlation, result);

        if (control?.loseStart) {
          controls.set(intent.correlation, { ...control, loseStart: false });
          response.destroy();

          return;
        }

        await sendResult(signatures.get(intent.correlation), intent.correlation);

        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/signatures/")) {
        const correlation = decodeURIComponent(url.pathname.slice("/signatures/".length));
        const result = signatures.get(correlation);

        if (!result) response.writeHead(404).end();
        else await sendResult(result, correlation);

        return;
      }

      if (request.method === "POST" && url.pathname === "/filings") {
        const { intent, attempt, xhtml } = Schema.decodeSync(Schema.fromJsonString(FilingRequest))(
          body,
        );

        if (!xhtml || !xhtml.startsWith("<html")) throw new Error("Stored XHTML required");

        if (!filings.has(intent.correlation))
          filings.set(intent.correlation, { intent, attempt, status: "uploaded" });
        const control = controls.get(intent.correlation);

        if (control?.loseUpload) {
          controls.set(intent.correlation, { ...control, loseUpload: false });
          response.destroy();

          return;
        }
      } else if (request.method === "POST" && url.pathname.endsWith("/certify")) {
        const { intent } = Schema.decodeSync(Schema.fromJsonString(FilingRequest))(body);
        const retained = filings.get(intent.correlation);

        if (!retained) {
          response.writeHead(404).end();

          return;
        }

        retained.status = "submitted";
      } else if (!(request.method === "GET" && url.pathname.startsWith("/filings/"))) {
        response.writeHead(404).end();

        return;
      }

      const correlation =
        url.pathname === "/filings" || url.pathname.endsWith("/certify")
          ? Schema.decodeSync(Schema.fromJsonString(FilingRequest))(body).intent.correlation
          : decodeURIComponent(url.pathname.slice("/filings/".length));

      const retained = filings.get(correlation);

      if (!retained) {
        response.writeHead(404).end();

        return;
      }

      const lostCollect = controls.get(correlation);

      if (request.method === "GET" && lostCollect?.loseCollect) {
        controls.set(correlation, { ...lostCollect, loseCollect: false });
        response.destroy();

        return;
      }

      const { intent, attempt } = retained;
      const control = controls.get(correlation);
      const defect = control?.defect;

      const status =
        defect === "unsupported_status"
          ? "unqualified_completed"
          : (control?.status ?? retained.status);

      const payload: typeof Filing.FilingProviderReceipt.Type = {
        profile: "synthetic-filing-v1",
        entityId: defect === "wrong_entity" ? "other_entity" : intent.scope.entityId,
        fiscalYearId: defect === "wrong_year" ? "fy_other" : intent.fiscalYearId,
        artifactHash:
          defect === "wrong_artifact" ? `sha256:${"0".repeat(64)}` : intent.copyArtifactHash,
        intentId: intent.id,
        attemptId: defect === "wrong_attempt" ? "other_attempt" : attempt.id,
        correlation,
        environment: intent.environment,
        status,
        receiptId: `receipt_${correlation}_${status}`,
      };

      await sendResult({ keyId, payload, signature: signed(payload) }, correlation);
    };

    handle().catch(() => {
      if (!response.destroyed) response.writeHead(422).end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (!address || typeof address === "string")
    throw new Error("Document fixture did not bind loopback");

  return {
    url: `http://127.0.0.1:${address.port}`,
    secret,
    serviceToken,
    publicKey,
    keyId,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
