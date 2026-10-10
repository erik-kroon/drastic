import { BoundedJsonError, readBoundedJson } from "../bounded-json";
import { AiEgressError, requireAiEgress, type AiEgress, type AiProvider } from "../ai-egress";

export class DocumentOutputError extends Error {}

export interface DocumentReader {
  readonly identity: string;
  submit(bytes: Uint8Array, egress: AiEgress): Promise<string>;
  poll(operation: string, egress: AiEgress): Promise<unknown>;
}

async function boundedJson(response: Response) {
  if (!response.ok || response.body === null) throw new Error("reader_response");

  try {
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof BoundedJsonError)
      throw new DocumentOutputError(
        error.kind === "size" ? "reader_output_size" : "reader_output_json",
      );

    throw error;
  }
}

// Callers supply an approved endpoint and secret. No deployment enables this
// adapter implicitly; the local fixture uses the same HTTP protocol on loopback.
export function azureInvoiceReader(
  endpoint: string,
  key: string,
  policy: AiProvider,
): DocumentReader {
  const origin = new URL(endpoint);

  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    !(
      origin.protocol === "https:" ||
      (origin.protocol === "http:" && origin.hostname === "127.0.0.1")
    )
  ) {
    throw new Error("reader_endpoint");
  }

  if (
    policy.destination !== origin.origin ||
    policy.provider !== "azure-document-intelligence" ||
    policy.modelRelease !== "prebuilt-invoice:2024-11-30" ||
    (policy.policy === "local-fixture" &&
      !(origin.protocol === "http:" && origin.hostname === "127.0.0.1"))
  )
    throw new AiEgressError();

  const prefix = "/documentintelligence/documentModels/prebuilt-invoice";

  const operationUrl = (value: string) => {
    const url = new URL(value);

    if (
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      url.hash ||
      !new RegExp(`^${prefix}/analyzeResults/[a-zA-Z0-9-]{1,128}$`).test(url.pathname) ||
      url.search !== "?api-version=2024-11-30"
    )
      throw new Error("reader_operation_location");

    return url;
  };

  return {
    identity: `azure-invoice-v1:${origin.origin}`,
    async submit(bytes, egress) {
      await requireAiEgress(egress).raw(policy, "document_submit", bytes);
      // The base64 request cannot ask the provider to fetch a caller-controlled URL.
      let binary = "";

      for (const byte of bytes) binary += String.fromCharCode(byte);

      const response = await fetch(
        new URL(
          `${prefix}:analyze?api-version=2024-11-30&stringIndexType=utf16CodeUnit&locale=sv-SE`,
          origin,
        ),
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: { "content-type": "application/json", "Ocp-Apim-Subscription-Key": key },
          body: JSON.stringify({ base64Source: btoa(binary) }),
        },
      );

      try {
        if (response.status !== 202) throw new Error("reader_submission_unknown");

        return operationUrl(response.headers.get("operation-location") ?? "").href;
      } finally {
        await response.body?.cancel();
      }
    },
    async poll(operation, egress) {
      const url = operationUrl(operation);
      await requireAiEgress(egress).raw(policy, "document_poll", operation);

      return boundedJson(
        await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: { "Ocp-Apim-Subscription-Key": key },
        }),
      );
    },
  };
}
