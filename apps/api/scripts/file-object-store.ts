import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import * as Schema from "effect/Schema";
import { maxSourceBytes } from "@open-erp/contracts/source-intake";
import { RetainedObject, type RetainedObjectStore } from "../src/adapters/storage/retained-objects";

const exists = Schema.Struct({ code: Schema.Literal("EEXIST") });
const missing = Schema.Struct({ code: Schema.Literal("ENOENT") });

async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || (await realpath(path)) !== path || (info.mode & 0o077) !== 0)
    throw new Error("Document storage must be a private directory without symlinks.");
}

export async function fileObjectStore(directory: string): Promise<RetainedObjectStore> {
  if (!isAbsolute(directory)) throw new Error("Document storage needs an absolute directory.");
  await privateDirectory(directory);
  async function objectPath(key: string, create: boolean) {
    Schema.decodeSync(RetainedObject.fields.objectKey)(key);
    const [version, book] = key.split("/");
    if (!version || !book) throw new Error("Invalid retained object key.");
    const parent = join(directory, version, book);
    if (create) {
      await privateDirectory(join(directory, version));
      await privateDirectory(parent);
    } else if ((await realpath(parent)) !== parent) {
      throw new Error("Retained object directories cannot be symlinks.");
    }
    return join(directory, key);
  }
  return {
    async get(key) {
      try {
        const file = await open(
          await objectPath(key, false),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size < 1 || info.size > maxSourceBytes)
            throw new Error("Retained object has an invalid size or file type.");
          return new Uint8Array(await file.readFile());
        } finally {
          await file.close();
        }
      } catch (error) {
        if (Schema.is(missing)(error)) return null;
        throw error;
      }
    },
    async put(key, bytes) {
      const destination = await objectPath(key, true);
      const temporary = `${destination}.${crypto.randomUUID()}.partial`;
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
        // Publish complete bytes atomically without replacing an existing original.
        try {
          await link(temporary, destination);
        } catch (error) {
          if (!Schema.is(exists)(error)) throw error;
        }
        const parent = await open(dirname(destination), constants.O_RDONLY | constants.O_DIRECTORY);
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      } finally {
        await file.close();
        await unlink(temporary);
      }
    },
  };
}
