import { assertUniqueJsonKeys } from "../json-keys";

export class DocumentOutputError extends Error {}

export interface DocumentReader {
  readonly identity: string;
  submit(bytes: Uint8Array): Promise<string>;
  poll(operation: string): Promise<unknown>;
}

async function boundedJson(response: Response) {
  if (!response.ok || response.body === null) throw new Error("reader_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) break;
      length += next.value.length;

      if (length > 1024 * 1024) throw new DocumentOutputError("reader_output_size");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    assertUniqueJsonKeys(bytes);

    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );

    return value;
  } catch {
    throw new DocumentOutputError("reader_output_json");
  }
}

// Callers supply an approved endpoint and secret. No deployment enables this
// adapter implicitly; the local fixture uses the same HTTP protocol on loopback.
export function azureInvoiceReader(endpoint: string, key: string): DocumentReader {
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
    async submit(bytes) {
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
    async poll(operation) {
      return boundedJson(
        await fetch(operationUrl(operation), {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: { "Ocp-Apim-Subscription-Key": key },
        }),
      );
    },
  };
}
