import * as Processor from "@open-erp/contracts/processor-clearing";

export type ProcessorPageRequest = {
  readonly providerAccountId: string;
  readonly liveMode: boolean;
  readonly currency: string;
  readonly currencyScale: number;
  readonly selection: typeof Processor.FetchSelection.Type;
  readonly cursor: string | null;
};

export interface ProcessorFeed {
  readonly identity: "local-fixture-v1";
  fetchPage(request: ProcessorPageRequest): Promise<{
    readonly bytes: Uint8Array;
  }>;
}

export function configuredProcessorFeed(settings: {
  readonly OPENERP_PROCESSOR_FEED?: string;
  readonly OPENERP_PROCESSOR_ENDPOINT?: string;
  readonly OPENERP_PROCESSOR_SECRET?: string;
}): ProcessorFeed | undefined {
  if (
    settings.OPENERP_PROCESSOR_FEED === undefined ||
    settings.OPENERP_PROCESSOR_FEED === "disabled"
  )
    return undefined;

  if (settings.OPENERP_PROCESSOR_FEED !== "local-fixture")
    throw new Error("Processor feed profile is unavailable.");
  const endpoint = settings.OPENERP_PROCESSOR_ENDPOINT;
  const secret = settings.OPENERP_PROCESSOR_SECRET;

  if (!endpoint || !secret || secret.length < 32 || secret.length > 512)
    throw new Error("Authenticated processor fixture configuration is required.");
  const origin = new URL(endpoint);

  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.port === "" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error(
      "Processor fixture must use a bare loopback HTTP origin with an explicit port.",
    );

  return {
    identity: "local-fixture-v1",
    async fetchPage(request) {
      const url = new URL("/balance-transactions", origin);
      url.searchParams.set("account", request.providerAccountId);
      url.searchParams.set("livemode", String(request.liveMode));
      url.searchParams.set("currency", request.currency);
      url.searchParams.set("scale", String(request.currencyScale));
      url.searchParams.set("startsOn", request.selection.startsOn);
      url.searchParams.set("endsOn", request.selection.endsOn);
      url.searchParams.set("view", request.selection.view);

      if (request.selection.view === "automatic_payout")
        url.searchParams.set("payout", request.selection.providerPayoutId);

      if (request.cursor !== null) url.searchParams.set("cursor", request.cursor);

      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      });

      if (!response.ok || response.body === null)
        throw new Error("Processor fixture response unavailable.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;

      try {
        for (;;) {
          const chunk = await reader.read();

          if (chunk.done) break;
          size += chunk.value.byteLength;

          if (size > 65536) throw new Error("Processor page exceeds its bound.");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }

      const bytes = new Uint8Array(size);
      let offset = 0;

      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return { bytes };
    },
  };
}
