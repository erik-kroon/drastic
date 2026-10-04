import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { createRequire } from "node:module";

const { Client } = createRequire(new URL("../../apps/api/package.json", import.meta.url))("pg");

process.umask(0o077);

const file = process.argv[2];

if (
  !file ||
  basename(file) !== "session.json" ||
  !basename(dirname(file)).startsWith("openerp-paper-")
)
  throw new Error("Use a private disposable session.");

const scratch = await realpath(dirname(file)),
  session = JSON.parse(await readFile(file, "utf8")),
  target = JSON.parse(await readFile(join(scratch, "operations-target2.json"), "utf8"));

if (
  !["openerp_ops_source_paper", "openerp_ops_source_cutover"].includes(target.database) ||
  new URL(session.apiUrl).hostname !== "127.0.0.1"
)
  throw new Error("Only the dedicated local synthetic owner.");

const client = new Client({
  host: target.host,
  port: target.port,
  user: target.user,
  password: target.password,
  database: target.database,
});

await client.connect();

let objects;

try {
  objects = (
    await client.query(
      "select c.object_key,c.sha256,c.byte_length,(select id from openerp.intake_occurrences o where o.book_id=c.book_id and o.sha256=c.sha256 order by id limit 1) as occurrence_id from openerp.intake_contents c where c.book_id='book_synthetic' and c.object_key is not null order by c.object_key",
    )
  ).rows;
} finally {
  await client.end();
}

const login = await fetch(session.url + "/api/auth/sign-in/email", {
  method: "POST",
  headers: { origin: session.url, "content-type": "application/json" },
  body: JSON.stringify({ email: session.email, password: session.password }),
});

if (!login.ok) throw new Error("Synthetic login failed.");

const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");

const directory = join(scratch, "original-objects");

await mkdir(directory, { mode: 0o700 });

for (const object of objects) {
  if (!/^v1\/book_synthetic\/[a-f0-9]{64}$/.test(object.object_key))
    throw new Error("Unknown retained object owner.");

  const response = await fetch(
    session.url +
      "/api/v1/entities/entity_synthetic/books/book_synthetic/source-occurrences/" +
      object.occurrence_id,
    { headers: { cookie }, signal: AbortSignal.timeout(15000) },
  );

  const original = await response.json();

  if (!response.ok) throw new Error("Original owner refused export.");
  const bytes = Buffer.from(original.contentBase64, "base64");

  if (
    bytes.length !== Number(object.byte_length) ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== object.sha256 ||
    original.occurrence.sha256 !== object.sha256
  )
    throw new Error("Retained original hash or length differs.");
  await mkdir(join(directory, "v1/book_synthetic"), { recursive: true, mode: 0o700 });
  await writeFile(join(directory, object.object_key), bytes, { mode: 0o600, flag: "wx" });
}

console.info(
  JSON.stringify({
    synthetic: true,
    verifiedRetainedObjects: objects.length,
    productionAction: "disabled",
  }),
);
