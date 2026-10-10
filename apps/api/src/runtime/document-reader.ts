import { azureInvoiceReader, type DocumentReader } from "../adapters/document-reading/azure";
import { configuredAiProvider } from "./ai-egress";

type Configuration = Readonly<Record<string, string | undefined>>;

// Both the admission server and the background worker use this configuration.
// Merely supplying credentials cannot enable disclosure.
export function configuredDocumentReader(config: Configuration): DocumentReader | undefined {
  const mode = config.OPENERP_DOCUMENT_READER ?? "disabled";

  if (mode === "disabled") return undefined;

  if (mode !== "azure-invoice-v1" && mode !== "local-azure-fixture")
    throw new Error("Unsupported document reader configuration.");

  const endpoint = config.OPENERP_DOCUMENT_READER_ENDPOINT;

  if (!endpoint) throw new Error("Document reader endpoint is required.");
  const url = new URL(endpoint);

  if (mode === "local-azure-fixture") {
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

  const key = config.OPENERP_DOCUMENT_READER_KEY;

  if (url.protocol !== "https:" || !key?.trim())
    throw new Error("Live document reading requires HTTPS and a configured credential.");

  return azureInvoiceReader(
    endpoint,
    key,
    configuredAiProvider(
      config,
      "azure-document-intelligence",
      "prebuilt-invoice:2024-11-30",
      false,
      url.origin,
    ),
  );
}
