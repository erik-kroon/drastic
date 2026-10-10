import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { assertUniqueJsonKeys } from "./json-keys";

export class BoundedJsonError extends Error {
  constructor(readonly kind: "size" | "json") {
    super(`bounded_json_${kind}`);
  }
}

export async function readBoundedJson(
  response: Response,
  maximumBytes = 1024 * 1024,
): Promise<Schema.Json> {
  if (response.body === null) throw new BoundedJsonError("json");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) break;

      length += next.value.length;

      if (length > maximumBytes) throw new BoundedJsonError("size");

      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    assertUniqueJsonKeys(bytes);

    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );

    const decoded = Schema.decodeUnknownResult(Schema.Json)(value);

    if (Result.isFailure(decoded)) throw new BoundedJsonError("json");

    return decoded.success;
  } catch {
    throw new BoundedJsonError("json");
  }
}

export function assertBoundedJsonValue(value: unknown, maximumBytes = 1024 * 1024): void {
  let minimumBytes = 0;

  try {
    const text = JSON.stringify(value, function parseEntry(key: string, entry: unknown) {
      minimumBytes += key.length + 2;

      if (typeof entry === "string") minimumBytes += entry.length;

      if (minimumBytes > maximumBytes) throw new BoundedJsonError("size");

      return entry;
    });

    if (text === undefined) throw new BoundedJsonError("json");

    if (text.length > maximumBytes || new TextEncoder().encode(text).length > maximumBytes)
      throw new BoundedJsonError("size");
  } catch (error) {
    if (error instanceof BoundedJsonError) throw error;

    throw new BoundedJsonError("json");
  }
}
