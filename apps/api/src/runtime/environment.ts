import type * as Accounting from "@open-erp/domain/values";
import type { R2Bucket, Workflow } from "@cloudflare/workers-types";
import * as Context from "effect/Context";
import type { RetainedObjectStore } from "../adapters/storage/retained-objects";

export interface Bindings {
  readonly PREPARATION_WORKFLOW?: Workflow<{ jobId: string; scope: typeof Accounting.Scope.Type }>;
  readonly OPENERP_PREPARATION_TOKEN?: string;
  readonly EVIDENCE_BUCKET?: R2Bucket;
  readonly EVIDENCE_STORE?: RetainedObjectStore;
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
