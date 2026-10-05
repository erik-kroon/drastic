import * as Contracts from "@open-erp/contracts/peppol-exchange";
import * as Schema from "effect/Schema";
import { assertUniqueJsonKeys } from "../json-keys";

export interface PeppolAccessPoint {
  readonly identity: "synthetic-ap-v1";
  validate(
    input: typeof Contracts.ValidationRequest.Type,
  ): Promise<typeof Contracts.ValidationReport.Type>;
  submit(
    input: typeof Contracts.ProviderMessage.Type,
  ): Promise<typeof Contracts.ProviderOutcome.Type>;
  status(providerKey: string): Promise<typeof Contracts.ProviderStatus.Type>;
  receive(messageId: string): Promise<typeof Contracts.Envelope.Type>;
}

export function configuredPeppolAccessPoint(settings: {
  readonly OPENERP_PEPPOL_EXCHANGE?: string;
  readonly OPENERP_PEPPOL_ENDPOINT?: string;
  readonly OPENERP_PEPPOL_SECRET?: string;
}): PeppolAccessPoint | undefined {
  if (
    settings.OPENERP_PEPPOL_EXCHANGE === undefined ||
    settings.OPENERP_PEPPOL_EXCHANGE === "disabled"
  )
    return undefined;

  if (settings.OPENERP_PEPPOL_EXCHANGE !== "local-fixture")
    throw new Error("Peppol access-point profile unavailable");
  const endpoint = settings.OPENERP_PEPPOL_ENDPOINT;
  const secret = settings.OPENERP_PEPPOL_SECRET;

  if (!endpoint || !secret || secret.length < 32 || secret.length > 512)
    throw new Error("Authenticated Peppol fixture configuration required");
  const origin = new URL(endpoint);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.port === "" ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("Peppol fixture requires a bare loopback origin with an explicit port");

  async function exchange(
    path: string,
    method: "GET" | "POST",
    input?: typeof Contracts.ValidationRequest.Type | typeof Contracts.ProviderMessage.Type,
  ) {
    const request: RequestInit = {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        accept: "application/json",
      },
    };

    if (input !== undefined) request.body = JSON.stringify(input);
    const response = await fetch(new URL(path, origin), request);

    if (!response.ok || response.body === null)
      throw new Error("Peppol fixture response unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;

    try {
      for (;;) {
        const item = await reader.read();

        if (item.done) break;
        length += item.value.byteLength;

        if (length > 2097152) throw new Error("Peppol fixture response exceeds its bound");
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }

    const bytes = new Uint8Array(length);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    assertUniqueJsonKeys(bytes);

    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  }

  return {
    identity: "synthetic-ap-v1",
    validate: async (input) =>
      Schema.decodeSync(Schema.fromJsonString(Contracts.ValidationReport))(
        await exchange("/validate", "POST", input),
        { onExcessProperty: "error" },
      ),
    submit: async (input) =>
      Schema.decodeSync(Schema.fromJsonString(Contracts.ProviderOutcome))(
        await exchange("/messages", "POST", input),
        { onExcessProperty: "error" },
      ),
    status: async (key) =>
      Schema.decodeSync(Schema.fromJsonString(Contracts.ProviderStatus))(
        await exchange(`/messages/${encodeURIComponent(key)}`, "GET"),
        { onExcessProperty: "error" },
      ),
    receive: async (id) =>
      Schema.decodeSync(Schema.fromJsonString(Contracts.Envelope))(
        await exchange(`/inbound/${encodeURIComponent(id)}`, "GET"),
        { onExcessProperty: "error" },
      ),
  };
}
