import { Capabilities } from "@open-erp/contracts/capabilities";
import { effectCapability } from "./shared";
import { getDocumentSignatureManifest, getDocumentSignatureIntent } from "../documents/signatures";

export const documentSignatureCapabilities = {
  documents_get_signature_manifest: effectCapability(
    Capabilities.documents_get_signature_manifest,
    (token, input) => getDocumentSignatureManifest(token, input),
  ),
  documents_get_signature_intent: effectCapability(
    Capabilities.documents_get_signature_intent,
    (token, input) => getDocumentSignatureIntent(token, input),
  ),
};
