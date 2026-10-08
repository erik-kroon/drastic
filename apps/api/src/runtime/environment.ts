import type { PeppolAccessPoint } from "../adapters/peppol/local-fixture";
import type { DocumentDelivery } from "../adapters/documents/local-fixture";
import type { R2Bucket } from "@cloudflare/workers-types";
import * as Context from "effect/Context";
import type { RetainedObjectStore } from "../adapters/storage/retained-objects";

import type { DocumentReader } from "../adapters/document-reading/azure";
import type { DocumentInspection } from "../adapters/document-reading/inspection";

import type { ProcessorFeed } from "../adapters/processor/local-fixture";

import type { ReminderDelivery } from "../adapters/reminder-delivery/local-fixture";

export interface Bindings {
  readonly PEPPOL_EXCHANGE?: PeppolAccessPoint;
  readonly OPENERP_PEPPOL_EXCHANGE?: string;
  readonly OPENERP_PEPPOL_ENDPOINT?: string;
  readonly OPENERP_PEPPOL_SECRET?: string;
  readonly DOCUMENT_DELIVERY?: DocumentDelivery;
  readonly OPENERP_DOCUMENT_DELIVERY?: string;
  readonly OPENERP_DOCUMENT_ENDPOINT?: string;
  readonly OPENERP_DOCUMENT_SECRET?: string;
  readonly OPENERP_DOCUMENT_PUBLIC_KEY?: string;
  readonly OPENERP_DOCUMENT_KEY_ID?: string;
  readonly PROCESSOR_FEED?: ProcessorFeed;
  readonly OPENERP_PROCESSOR_FEED?: string;
  readonly OPENERP_PROCESSOR_ENDPOINT?: string;
  readonly OPENERP_PROCESSOR_SECRET?: string;
  readonly REMINDER_DELIVERY?: ReminderDelivery;
  readonly DOCUMENT_READER?: DocumentReader;
  readonly DOCUMENT_INSPECTOR?: (
    bytes: Uint8Array,
    mediaType: string,
  ) => Promise<DocumentInspection>;
  readonly OPENERP_PREPARATION_TOKEN?: string;
  readonly EVIDENCE_BUCKET?: R2Bucket;
  readonly EVIDENCE_STORE?: RetainedObjectStore;
  readonly OPENERP_AUTH_MODE?: string;
  readonly OIDC_ISSUER?: string;
  readonly OIDC_CLIENT_ID?: string;
  readonly OIDC_CLIENT_SECRET?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly BETTER_AUTH_URL?: string;
  readonly DATABASE_URL?: string;
  readonly HYPERDRIVE?: { readonly connectionString: string };
}

export class RequestEnvironment extends Context.Service<
  RequestEnvironment,
  {
    readonly bindings: Bindings;
    readonly url: URL;
  }
>()("open-erp/RequestEnvironment") {}
