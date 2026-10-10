import { azureInvoiceReader } from "./azure";
import { configuredAiProvider } from "../../runtime/ai-egress";

export function localDocumentReader(
  endpoint: string,
  config: Readonly<Record<string, string | undefined>> = {},
) {
  const url = new URL(endpoint);

  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("The document fixture must use HTTP on IPv4 loopback.");

  return azureInvoiceReader(
    endpoint,
    "synthetic-local-key",
    configuredAiProvider(
      config,
      "azure-document-intelligence",
      "prebuilt-invoice:2024-11-30",
      true,
      url.origin,
    ),
  );
}
