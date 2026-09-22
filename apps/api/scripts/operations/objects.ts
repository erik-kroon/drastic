import { Client } from "pg";
import * as Schema from "effect/Schema";
import { maxSourceBytes } from "@open-erp/contracts/source-intake";
import { TableFingerprint } from "@open-erp/contracts/operations";
import { RetainedObject } from "../../src/retained-objects";
import { fileObjectStore } from "../file-object-store";
import { filesIn } from "./artifacts";
import { artifactPath, fingerprint, privatePath, refuse } from "./safety";

type Reference = typeof RetainedObject.Type;

export async function objectReferences(
  client: Client,
  tables: ReadonlyArray<typeof TableFingerprint.Type>,
) {
  if (!tables.some((table) => table.schema === "openerp" && table.table === "intake_contents"))
    return [];
  const columns = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema='openerp' AND table_name='intake_contents' AND column_name='object_key'",
  );
  if (columns.rowCount === 0) return [];
  const integrity = await client.query<{ invalid: boolean }>(`SELECT
    EXISTS(SELECT FROM openerp.intake_contents c WHERE c.bytes IS NOT NULL
      AND c.sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(c.bytes),'hex'))
    OR EXISTS(SELECT FROM openerp.intake_occurrences o LEFT JOIN openerp.intake_contents c
      ON c.book_id=o.book_id AND c.sha256=o.sha256
      WHERE c.sha256 IS NULL OR o.body->>'sha256' IS DISTINCT FROM c.sha256
        OR (o.body->>'byteLength')::integer IS DISTINCT FROM coalesce(octet_length(c.bytes),c.byte_length)) AS invalid`);
  if (integrity.rows[0]?.invalid !== false)
    refuse("Retained originals disagree with their content manifests.");
  const result = await client.query<{ body: unknown }>(`SELECT jsonb_build_object(
    'objectKey',object_key,'sha256',sha256,'byteLength',byte_length) AS body
    FROM openerp.intake_contents WHERE object_key IS NOT NULL ORDER BY object_key`);
  return result.rows.map((row) => Schema.decodeUnknownSync(RetainedObject)(row.body));
}

async function archiveReader() {
  const directory = process.env.OPENERP_OBJECT_DIRECTORY;
  if (directory) {
    if (process.env.OPENERP_R2_ENDPOINT)
      refuse("Choose one archive source: local directory or R2.");
    await privatePath(directory, true);
    return fileObjectStore(directory);
  }
  const endpoint = process.env.OPENERP_R2_ENDPOINT;
  const bucket = process.env.OPENERP_R2_BUCKET;
  const accessKeyId = process.env.OPENERP_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OPENERP_R2_SECRET_ACCESS_KEY;
  if (
    !endpoint ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !/^https:\/\/[a-f0-9]{32}(\.eu|\.fedramp)?\.r2\.cloudflarestorage\.com$/.test(endpoint)
  )
    return refuse(
      "Referenced originals require an explicit private object directory or R2 endpoint, bucket and read credentials.",
    );
  const client = new Bun.S3Client({ endpoint, bucket, accessKeyId, secretAccessKey });
  return {
    async get(key: string) {
      const response = await fetch(client.presign(key, { method: "GET", expiresIn: 60 }), {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return refuse("A referenced archive object could not be read.");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > maxSourceBytes)
            return refuse("A retained object exceeds its supported size.");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    },
  };
}

export async function captureObjects(root: string, references: ReadonlyArray<Reference>) {
  if (references.length === 0) return;
  const source = await archiveReader();
  const destination = await fileObjectStore(artifactPath(root, "objects"));
  for (const reference of references) {
    const bytes = await source.get(reference.objectKey);
    if (
      !bytes ||
      bytes.length !== reference.byteLength ||
      `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}` !== reference.sha256
    )
      refuse("A referenced original is missing or fails its size/hash check.");
    await destination.put(reference.objectKey, bytes);
  }
  await verifyObjects(root, references);
}

export async function verifyObjects(root: string, references: ReadonlyArray<Reference>) {
  const expected = references.map((reference) => `objects/${reference.objectKey}`).sort();
  const actual = (await filesIn(root)).filter((path) => path.startsWith("objects/"));
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    refuse("Object inventory differs from PostgreSQL's snapshot references.");
  for (const reference of references) {
    const file = await fingerprint(artifactPath(root, `objects/${reference.objectKey}`));
    if (file.sha256 !== reference.sha256.slice(7) || file.bytes !== String(reference.byteLength))
      refuse("A referenced original failed reconstruction validation.");
  }
}
