import { localDocumentReader } from "../src/adapters/document-reading/local-fixture";
import { configuredDocumentReader } from "../src/runtime/document-reader";

export function configuredSelfHostDocumentReader(
  config: Readonly<Record<string, string | undefined>>,
) {
  if (config.OPENERP_DOCUMENT_READER !== "local-azure-fixture")
    return configuredDocumentReader(config);

  const endpoint = config.OPENERP_DOCUMENT_READER_ENDPOINT;

  if (!endpoint) throw new Error("Document reader endpoint is required.");

  return localDocumentReader(endpoint, config);
}
