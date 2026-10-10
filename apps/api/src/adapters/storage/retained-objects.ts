import * as Effect from "effect/Effect";
import type { R2Bucket } from "@cloudflare/workers-types";
import { RetainedObjectReference as RetainedObject } from "@open-erp/contracts/operations";
import { maxSourceBytes } from "@open-erp/contracts/source-intake";
import { failure } from "../../application/failures";
import { RequestEnvironment } from "../../runtime/environment";

export { RetainedObject };

export interface RetainedObjectStore {
  readonly get: (key: string) => Promise<Uint8Array | null>;
  readonly put: (key: string, bytes: Uint8Array) => Promise<void>;
}

export const sourceDigest = Effect.fn("Source.digest")(function* (bytes: Uint8Array) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    catch: () => failure("Unavailable"),
  });

  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
});

export function r2ObjectStore(bucket: R2Bucket): RetainedObjectStore {
  return {
    async get(key) {
      const object = await bucket.get(key);

      if (!object) return null;

      if (object.size > maxSourceBytes) {
        await object.body.cancel();
        throw new Error("Retained object exceeds the supported size.");
      }

      return new Uint8Array(await object.arrayBuffer());
    },
    async put(key, bytes) {
      await bucket.put(key, bytes, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/octet-stream" },
      });
    },
  };
}

export const objectStore = Effect.gen(function* () {
  const { bindings } = yield* RequestEnvironment;

  if (bindings.EVIDENCE_STORE) return bindings.EVIDENCE_STORE;

  if (bindings.EVIDENCE_BUCKET) return r2ObjectStore(bindings.EVIDENCE_BUCKET);

  return yield* failure("Unavailable");
});

export const readRetainedObject = Effect.fn("Source.readObject")(function* (
  store: RetainedObjectStore,
  reference: typeof RetainedObject.Type,
) {
  const bytes = yield* Effect.tryPromise({
    try: () => store.get(reference.objectKey),
    catch: () => failure("Unavailable"),
  });

  if (!bytes || bytes.byteLength !== reference.byteLength) return yield* failure("MissingEvidence");

  if ((yield* sourceDigest(bytes)) !== reference.sha256) return yield* failure("MissingEvidence");

  return bytes;
});
