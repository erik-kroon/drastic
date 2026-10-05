import * as Schema from "effect/Schema";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Result from "effect/Result";
import * as Documents from "@open-erp/contracts/document-signatures";
import * as Filing from "@open-erp/contracts/filing-lifecycle";

type FixtureCommand =
  | {
      readonly intent: typeof Documents.DocumentSignatureIntent.Type;
      readonly manifest: typeof Documents.DocumentManifest.Type;
      readonly xhtml: string;
    }
  | {
      readonly intent: typeof Filing.FilingIntent.Type;
      readonly attempt: typeof Filing.FilingAttempt.Type;
      readonly xhtml?: string;
    };

export interface DocumentDelivery {
  readonly identity: "synthetic-loopback";
  readonly verificationKey: typeof Documents.FixtureVerificationKey.Type;
  signature(
    action: "start" | "collect",
    intent: typeof Documents.DocumentSignatureIntent.Type,
    manifest: typeof Documents.DocumentManifest.Type,
    xhtml: string,
  ): Promise<typeof Documents.SignatureProviderResult.Type | null>;
  filing(
    action: "upload" | "certify" | "collect",
    intent: typeof Filing.FilingIntent.Type,
    attempt: typeof Filing.FilingAttempt.Type,
    xhtml: string,
  ): Promise<typeof Filing.FilingProviderResult.Type | null>;
  verify(keyId: string, payload: Schema.JsonObject, signature: string): Promise<boolean>;
}

export function configuredDocumentDelivery(settings: {
  readonly OPENERP_DOCUMENT_DELIVERY?: string;
  readonly OPENERP_DOCUMENT_ENDPOINT?: string;
  readonly OPENERP_DOCUMENT_SECRET?: string;
  readonly OPENERP_DOCUMENT_PUBLIC_KEY?: string;
  readonly OPENERP_DOCUMENT_KEY_ID?: string;
}): DocumentDelivery | undefined {
  if (!settings.OPENERP_DOCUMENT_DELIVERY || settings.OPENERP_DOCUMENT_DELIVERY === "disabled")
    return undefined;

  if (settings.OPENERP_DOCUMENT_DELIVERY !== "local-fixture")
    throw new Error("Document delivery profile unavailable");
  const endpoint = settings.OPENERP_DOCUMENT_ENDPOINT;
  const secret = settings.OPENERP_DOCUMENT_SECRET;
  const publicKey = settings.OPENERP_DOCUMENT_PUBLIC_KEY;
  const keyId = settings.OPENERP_DOCUMENT_KEY_ID;

  if (!endpoint || !secret || secret.length < 32 || secret.length > 512 || !publicKey || !keyId)
    throw new Error("Authenticated document fixture configuration required");
  const origin = new URL(endpoint);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    !origin.port ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Document fixture requires a bare loopback origin");
  const rawKey = Uint8Array.from(atob(publicKey), (character) => character.charCodeAt(0));

  if (rawKey.byteLength !== 32) throw new Error("Document Ed25519 key must contain 32 bytes");

  async function call(path: string, body?: FixtureCommand) {
    const controller = new AbortController();

    const response = await fetch(new URL(path, origin), {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    });

    if (response.status === 404) {
      await response.body?.cancel();

      return null;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Document fixture unavailable");
    }

    const reader = response.body?.getReader();

    if (!reader) throw new Error("Document fixture response body required");
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    let bytes = 0;
    let text = "";

    try {
      while (true) {
        const chunk = await reader.read();

        if (chunk.done) return text + decoder.decode();
        bytes += chunk.value.byteLength;

        if (bytes > 65536) {
          controller.abort();
          throw new Error("Document fixture response exceeds bound");
        }

        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  }

  return {
    identity: "synthetic-loopback",
    verificationKey: { algorithm: "Ed25519", keyId, publicKey },
    async signature(action, intent, manifest, xhtml) {
      const prior = await call(`/signatures/${encodeURIComponent(intent.correlation)}`);

      const text =
        prior ??
        (action === "start" ? await call("/signatures", { intent, manifest, xhtml }) : null);

      return text === null
        ? null
        : Schema.decodeSync(Schema.fromJsonString(Documents.SignatureProviderResult))(text, {
            onExcessProperty: "error",
          });
    },
    async filing(action, intent, attempt, xhtml) {
      let text: string | null;

      if (action === "certify")
        text = await call(`/filings/${encodeURIComponent(intent.correlation)}/certify`, {
          intent,
          attempt,
        });
      else {
        const prior = await call(`/filings/${encodeURIComponent(intent.correlation)}`);
        text =
          prior ??
          (action === "upload" ? await call("/filings", { intent, attempt, xhtml }) : null);
      }

      return text === null
        ? null
        : Schema.decodeSync(Schema.fromJsonString(Filing.FilingProviderResult))(text, {
            onExcessProperty: "error",
          });
    },
    async verify(actualKeyId, payload, signature) {
      if (actualKeyId !== keyId) return false;
      const canonical = canonicalizeJson(payload);

      if (Result.isFailure(canonical)) return false;

      try {
        const key = await crypto.subtle.importKey("raw", rawKey, "Ed25519", false, ["verify"]);
        const bytes = Uint8Array.from(atob(signature), (character) => character.charCodeAt(0));

        return await crypto.subtle.verify(
          "Ed25519",
          key,
          bytes,
          new Uint8Array(canonical.success.bytes),
        );
      } catch {
        return false;
      }
    },
  };
}
