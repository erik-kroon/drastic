/** Operator-run Plaid Transactions Sync job. Secrets stay outside the repository and database. */
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import * as Schema from "effect/Schema";
import * as Connector from "@open-erp/contracts/bank-connector";
import * as Intake from "@open-erp/contracts/source-intake";

const Config = Schema.Struct({
  apiOrigin: Schema.String,
  entityId: Schema.String,
  bookId: Schema.String,
  consentId: Schema.String,
  accountId: Schema.String,
  host: Schema.Literals(["sandbox", "development", "production"]),
  clientId: Schema.String,
  secret: Schema.String,
  accessToken: Schema.String,
});
const PlaidPage = Schema.Struct({
  added: Schema.Array(Schema.Unknown),
  modified: Schema.Array(Schema.Unknown),
  removed: Schema.Array(Schema.Unknown),
  has_more: Schema.Boolean,
  next_cursor: Schema.String,
});
const UpdateIdentity = Schema.Struct({ account_id: Schema.String, transaction_id: Schema.String });
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fail = (message: string): never => {
  throw new Error(message);
};
const file = resolve(
  process.argv[2] ?? fail("Pass an absolute path to a private Plaid connector configuration file."),
);
const info = await lstat(file);
if (!info.isFile() || (info.mode & 0o177) !== 0)
  fail("Connector config must be a regular file with mode 0600.");
let config: typeof Config.Type;
try {
  config = Schema.decodeUnknownSync(Config)(JSON.parse(await readFile(file, "utf8")));
} catch {
  throw new Error("Cannot read or parse private connector config.");
}
const apiToken = process.env.OPENERP_CONNECTOR_TOKEN;
if (
  !apiToken ||
  !config.clientId ||
  !config.secret ||
  !config.accessToken ||
  !config.entityId ||
  !config.bookId ||
  !config.consentId ||
  !config.accountId ||
  !["sandbox", "development", "production"].includes(config.host)
)
  fail(
    "Provide complete Plaid credentials, account, book, consent, and a scoped operator API token.",
  );
const origin = new URL(config.apiOrigin);
if (
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  (origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))
)
  fail("The accounting API must use an HTTPS origin or loopback HTTP.");
const base = new URL(
  `/api/v1/entities/${encodeURIComponent(config.entityId)}/books/${encodeURIComponent(config.bookId)}`,
  origin,
);
const consentPath = `/bank-connector-consents/${encodeURIComponent(config.consentId)}`;
const headers = { authorization: `Bearer ${apiToken}`, "content-type": "application/json" };
async function accounting(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: string,
  key?: string,
): Promise<unknown> {
  const response = await fetch(
    new URL(base.pathname + path, origin),
    method === "POST"
      ? {
          method,
          headers: key ? { ...headers, "idempotency-key": key } : headers,
          body,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        }
      : { method, headers, redirect: "error", signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    fail(
      `Accounting API refused ${method} ${path}: HTTP ${response.status}. Inspect the scoped receipt before retrying.`,
    );
  return response.json();
}
const consent = Schema.decodeUnknownSync(Connector.ConnectorConsentState)(
  await accounting(consentPath),
);
if (
  consent.revoked ||
  consent.scope?.bookId !== config.bookId ||
  consent.scope?.entityId !== config.entityId ||
  consent.id !== config.consentId ||
  consent.providerId !== "plaid" ||
  consent.externalAccountId !== config.accountId ||
  typeof consent.cursor !== "string" ||
  consent.cursor.length > 256
)
  fail("Consent is revoked, mismatched, or has an invalid Plaid cursor. No provider request sent.");
// Each invocation has a bounded page count; later runs resume the committed cursor.
let cursor = consent.cursor;
for (let page = 0; page < 100; page++) {
  const requestKey = `plaid_${hash(`${config.bookId}:${config.consentId}:${cursor}`).slice(0, 48)}`;
  // A previous ambiguous write must be recovered before another remote fetch at this cursor.
  const recovery = await fetch(
    new URL(base.pathname + `/bank-connector-batch-requests/${requestKey}`, origin),
    { headers, redirect: "error", signal: AbortSignal.timeout(30000) },
  );
  if (recovery.ok) {
    const batch = Schema.decodeUnknownSync(Connector.ConnectorBatch)(await recovery.json());
    if (batch.previousCursor !== cursor || batch.providerOutcome !== "delivered")
      fail("A prior batch needs operator review.");
    cursor = batch.nextCursor;
    if (cursor === consent.cursor) fail("The recovered batch did not advance the cursor.");
    continue;
  }
  if (recovery.status !== 404)
    fail(`Batch recovery unavailable (HTTP ${recovery.status}); no provider request sent.`);
  const current = Schema.decodeUnknownSync(Connector.ConnectorConsentState)(
    await accounting(consentPath),
  );
  if (
    current.revoked ||
    current.cursor !== cursor ||
    current.sourceAccountId !== consent.sourceAccountId ||
    current.externalAccountId !== config.accountId
  )
    fail("Consent changed during sync; no provider request sent.");
  const sourceKey = `plaidraw_${hash(`${config.bookId}:${config.consentId}:${cursor}`).slice(0, 48)}`;
  const retained = await fetch(
    new URL(base.pathname + `/source-retention-requests/${sourceKey}`, origin),
    { headers, redirect: "error", signal: AbortSignal.timeout(30000) },
  );
  if (retained.status !== 404 && !retained.ok)
    fail(`Source recovery unavailable (HTTP ${retained.status}); no provider request sent.`);
  let bytes: Uint8Array;
  if (retained.ok) {
    const prior = Schema.decodeUnknownSync(Intake.SourceOccurrence)(await retained.json());
    if (
      prior.scope?.bookId !== config.bookId ||
      prior.sourceAccountId !== consent.sourceAccountId ||
      prior.sourceSystem !== "connector-raw:plaid"
    )
      fail("Recovered source does not match the configured consent.");
    let original: typeof Intake.SourceOccurrenceView.Type;
    try {
      original = Schema.decodeUnknownSync(Intake.SourceOccurrenceView)(
        await accounting(`/source-occurrences/${encodeURIComponent(prior.id)}`),
      );
    } catch {
      throw new Error("Recovered provider original is unavailable or malformed; cursor unchanged.");
    }
    bytes = Buffer.from(original.contentBase64, "base64");
    if (`sha256:${hash(bytes)}` !== prior.sha256)
      fail("Recovered provider bytes failed the original hash check.");
  } else {
    const provider = await fetch(`https://${config.host}.plaid.com/transactions/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PLAID-CLIENT-ID": config.clientId,
        "PLAID-SECRET": config.secret,
      },
      body: JSON.stringify({
        access_token: config.accessToken,
        account_id: config.accountId,
        cursor: cursor || undefined,
        count: 20,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!provider.ok)
      fail(
        `Plaid sync returned HTTP ${provider.status}; cursor unchanged. Do not log provider response or credentials.`,
      );
    bytes = new Uint8Array(await provider.arrayBuffer());
  }
  if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024)
    fail("Plaid page exceeds retained source limit; cursor unchanged.");
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let data: typeof PlaidPage.Type;
  try {
    data = Schema.decodeUnknownSync(PlaidPage)(JSON.parse(raw));
  } catch {
    throw new Error("Plaid response is invalid; cursor unchanged.");
  }
  const { added, modified, removed } = data;
  if (data.next_cursor.length > 256 || added.length + modified.length + removed.length > 20)
    fail("Unsupported Plaid cursor or update count; cursor unchanged.");
  if (
    !data.next_cursor &&
    (cursor || added.length || modified.length || removed.length || data.has_more)
  )
    fail("Plaid returned an empty cursor for a nonempty update stream; cursor unchanged.");
  if (data.next_cursor === cursor) {
    if (data.has_more || added.length || modified.length || removed.length)
      fail("Plaid returned updates without a new cursor; no updates retained.");
    console.info("No new Plaid updates; cursor unchanged.");
    break;
  }
  const updates = [
    ...added.map((item) => ({ kind: "added", item })),
    ...modified.map((item) => ({ kind: "modified", item })),
    ...removed.map((item) => ({ kind: "removed", item })),
  ];
  const records = updates.map(({ kind, item }) => {
    let identity: typeof UpdateIdentity.Type;
    try {
      identity = Schema.decodeUnknownSync(UpdateIdentity)(item);
    } catch {
      throw new Error("Plaid update is missing its account or transaction ID.");
    }
    if (
      identity.account_id !== config.accountId ||
      identity.transaction_id.length < 1 ||
      identity.transaction_id.length > 200
    )
      fail("Plaid update has a mismatched account or missing transaction ID.");
    const event = JSON.stringify({ kind, item });
    if (Buffer.byteLength(event) > 65536) fail("Plaid update exceeds record limit.");
    return { externalId: identity.transaction_id, revision: hash(event), raw: event };
  });
  const responseHash = hash(bytes);
  const batchInput = {
    providerOutcome: "delivered",
    previousCursor: cursor,
    nextCursor: data.next_cursor,
    sourceRevision: responseHash,
    records,
  };
  if (Buffer.byteLength(JSON.stringify(batchInput)) > 250000)
    fail("Mapped Plaid page exceeds the bank batch bound; cursor unchanged.");
  const source = Schema.decodeUnknownSync(Intake.SourceOccurrence)(
    await accounting(
      "/source-occurrences",
      "POST",
      JSON.stringify({
        sourceSystem: "connector-raw:plaid",
        sourceAccountId: consent.sourceAccountId,
        occurrenceKey: sourceKey,
        sourceRevision: responseHash,
        filename: "plaid-transactions-sync.json",
        mediaType: "application/json",
        contentBase64: Buffer.from(bytes).toString("base64"),
      }),
      sourceKey,
    ),
  );
  if (source.sha256 !== `sha256:${responseHash}` || source.scope?.bookId !== config.bookId)
    fail("Retained provider page hash or scope does not match; cursor unchanged.");
  // One batch commits records, source provenance and cursor atomically in PostgreSQL.
  const batch = Schema.decodeUnknownSync(Connector.ConnectorBatch)(
    await accounting(
      `${consentPath}/batches`,
      "POST",
      JSON.stringify({
        ...batchInput,
        sourceOccurrenceId: source.id,
      }),
      requestKey,
    ),
  );
  if (
    batch.previousCursor !== cursor ||
    batch.nextCursor !== data.next_cursor ||
    batch.sourceOccurrenceId !== source.id
  )
    fail("Batch receipt differs from the retained source; stop for operator review.");
  cursor = batch.nextCursor;
  console.info(
    `Retained Plaid page ${page + 1}; ${records.length} updates; batch ${batch.id}. No bank observations admitted.`,
  );
  if (!data.has_more) break;
  if (page === 99) fail("Plaid page limit reached; rerun to continue from committed cursor.");
}
