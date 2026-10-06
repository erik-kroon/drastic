import { createHash, randomBytes } from "node:crypto";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Source from "@open-erp/contracts/source-intake";
import { withDisposableBrowserDatabase } from "./browser-database";

export async function retainForeignBrowserOriginal(input: {
  readonly sessionFile: string;
  readonly origin: string;
  readonly currentActorId: string;
  readonly bytes: Uint8Array;
  readonly filename: string;
}) {
  const suffix = randomBytes(12).toString("hex");
  const scope = { entityId: `entity_original_${suffix}`, bookId: `book_original_${suffix}` };
  const actorId = `operator_original_${suffix}`;
  const token = randomBytes(32).toString("hex");

  Schema.decodeSync(Accounting.Identifier)(input.currentActorId);

  await withDisposableBrowserDatabase(input.sessionFile, input.origin, async (client) => {
    const current = await client.query<{ readonly role: string }>(
      "select role from openerp.memberships where book_id='book_synthetic' and actor_id=$1",
      [input.currentActorId],
    );

    if (current.rows.length !== 1 || current.rows[0]?.role !== "operator")
      throw new Error("The fixture requires the actual current synthetic operator");

    await client.query("BEGIN");

    try {
      await client.query("insert into openerp.entities(id,name) values ($1,$2)", [
        scope.entityId,
        "Synthetic unauthorized original entity",
      ]);
      await client.query(
        "insert into openerp.books(id,entity_id,name,currency,currency_scale,profile) values ($1,$2,$3,'SEK',2,'synthetic-core-v1')",
        [scope.bookId, scope.entityId, "Synthetic unauthorized original book"],
      );
      await client.query("insert into openerp.actors(id,name) values ($1,$2)", [
        actorId,
        "Synthetic foreign source fixture operator",
      ]);
      await client.query(
        "insert into openerp.memberships(book_id,actor_id,role) values ($1,$2,'operator')",
        [scope.bookId, actorId],
      );
      await client.query(
        "insert into openerp.credentials(token_hash,actor_id,expires_at) values ($1,$2,clock_timestamp()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), actorId],
      );

      const foreignMembers = await client.query<{ readonly actorId: string }>(
        'select actor_id as "actorId" from openerp.memberships where book_id=$1',
        [scope.bookId],
      );

      if (foreignMembers.rows.length !== 1 || foreignMembers.rows[0]?.actorId !== actorId)
        throw new Error(
          "The unauthorized original fixture must have only its separate source actor",
        );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  const response = await fetch(
    `${input.origin}/api/v1/entities/${scope.entityId}/books/${scope.bookId}/source-occurrences`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": `foreign_${suffix}`,
      },
      body: JSON.stringify({
        sourceSystem: "synthetic-p03-foreign",
        sourceAccountId: scope.bookId,
        occurrenceKey: suffix,
        sourceRevision: "1",
        filename: input.filename,
        mediaType: "application/pdf",
        contentBase64: Buffer.from(input.bytes).toString("base64"),
      }),
      signal: AbortSignal.timeout(20000),
    },
  );

  if (response.status !== 200)
    throw new Error(`Foreign fixture source retention refused HTTP ${response.status}`);

  const occurrence = Schema.decodeSync(Schema.fromJsonString(Source.SourceOccurrence))(
    await response.text(),
  );

  const expectedHash = `sha256:${createHash("sha256").update(input.bytes).digest("hex")}`;

  if (
    occurrence.scope.bookId !== scope.bookId ||
    occurrence.scope.entityId !== scope.entityId ||
    occurrence.sha256 !== expectedHash ||
    occurrence.retainedBy !== actorId
  )
    throw new Error("Foreign fixture retention scope, actor or original hash mismatch");

  return { scope, occurrence, currentOperatorMembership: false };
}
