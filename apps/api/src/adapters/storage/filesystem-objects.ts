import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { RetainedObjectStore } from "./retained-objects";
import { maxSourceBytes } from "@open-erp/contracts/source-intake";

// The Bun preparation runner has no Worker binding, so an original retained
// outside PostgreSQL needs a real store. A filesystem root keeps the same two
// properties the bucket store has: a key addresses exactly one object, and a put
// never overwrites an object that is already retained.
//
// This module is deliberately separate from retained-objects.ts: that file is
// bundled for the Worker runtime, which has no filesystem.
const objectKeyPattern = /^v1\/[a-z][a-z0-9_-]{2,127}\/[a-f0-9]{64}$/;

function isAbsent(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function filesystemObjectStore(root: string): RetainedObjectStore {
  const base = resolve(root);

  // The retained key grammar admits no traversal, and this confirms it before any
  // path is built, so a malformed key cannot reach outside the configured root.
  const pathFor = (key: string) => {
    if (!objectKeyPattern.test(key)) throw new Error("Retained object key is not a v1 object key.");

    const path = resolve(join(base, key));

    if (path !== base && !path.startsWith(base + sep)) {
      throw new Error("Retained object key resolves outside the configured root.");
    }

    return path;
  };

  return {
    async get(key) {
      const path = pathFor(key);

      try {
        const bytes = await readFile(path);

        if (bytes.byteLength > maxSourceBytes) {
          throw new Error("Retained object exceeds the supported size.");
        }

        return new Uint8Array(bytes);
      } catch (error) {
        // An absent object is an absence, not a storage failure: the caller decides
        // whether a missing original is missing evidence.
        if (isAbsent(error)) return null;
        throw error;
      }
    },
    async put(key, bytes) {
      if (bytes.byteLength > maxSourceBytes) {
        throw new Error("Retained object exceeds the supported size.");
      }

      const path = pathFor(key);

      await mkdir(dirname(path), { recursive: true });

      // 'wx' fails when the object already exists, which is the same no-overwrite
      // condition the bucket store states as onlyIf.etagDoesNotMatch.
      await writeFile(path, bytes, { flag: "wx" });
    },
  };
}
