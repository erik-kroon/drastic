import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import * as Schema from "effect/Schema";
import { ApplicationSequence } from "@open-erp/contracts/operations";
import { refuse } from "./safety";

export const applicationSequenceOwners = [
  { table: "ai_egress_admissions", column: "sequence" },
  { table: "ai_identity_tokens", column: "ordinal" },
  { table: "book_decision_policies", column: "sequence" },
  { table: "document_governance", column: "ordinal" },
  { table: "document_governance_reviews", column: "ordinal" },
  { table: "document_manifests", column: "ordinal" },
  { table: "document_signature_attempts", column: "ordinal" },
  { table: "document_signature_evidence", column: "ordinal" },
  { table: "document_signature_intents", column: "ordinal" },
  { table: "document_signature_observations", column: "ordinal" },
  { table: "document_validations", column: "ordinal" },
  { table: "filing_attempts", column: "ordinal" },
  { table: "filing_adoption_reviews", column: "ordinal" },
  { table: "filing_adoptions", column: "ordinal" },
  { table: "filing_authorizations", column: "ordinal" },
  { table: "filing_intents", column: "ordinal" },
  { table: "filing_observations", column: "ordinal" },
].map((owner) => ({ ...owner, name: `${owner.table}_${owner.column}_seq` }));

export async function readApplicationSequences(client: Client) {
  const sequences = await client.query<{ name: string; table: string; column: string }>(`
    SELECT c.relname AS name, t.relname AS table, a.attname AS column
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid
    JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_class'::regclass AND d.refobjsubid>0 AND d.deptype='i'
    JOIN pg_class t ON t.oid=d.refobjid AND t.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
    WHERE c.relkind='S' AND n.nspname='openerp' AND c.relpersistence='p' AND pg_get_userbyid(c.relowner)=current_user
      AND a.attidentity='a' AND s.seqtypid='bigint'::regtype AND s.seqstart=1 AND s.seqincrement=1
      AND s.seqmin=1 AND s.seqmax=9223372036854775807 AND s.seqcache=1 AND NOT s.seqcycle
    ORDER BY c.relname COLLATE "C"`);

  const relations = await client.query<{ table: string }>(
    "SELECT relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='openerp' AND relname=ANY($1::text[]) ORDER BY relname COLLATE \"C\"",
    [applicationSequenceOwners.map((owner) => owner.table)],
  );

  const presentTables = new Set(relations.rows.map((row) => row.table));

  const expected = applicationSequenceOwners
    .filter((owner) => presentTables.has(owner.table))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const count = await client.query<{ count: string }>(
    "SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT IN ('public','information_schema') AND n.nspname !~ '^pg_'",
  );

  if (
    count.rows[0]?.count !== String(expected.length) ||
    !isDeepStrictEqual(sequences.rows, expected)
  )
    refuse("UnhandledFamily: An application sequence has no reviewed identity table/column owner.");
  const result: Array<typeof ApplicationSequence.Type> = [];

  for (const sequence of expected) {
    const state = await client.query<{ lastValue: string; isCalled: boolean }>(
      `SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM openerp.${client.escapeIdentifier(sequence.name)}`,
    );

    result.push(
      Schema.decodeUnknownSync(ApplicationSequence)({
        schema: "openerp",
        ...sequence,
        ...state.rows[0],
      }),
    );
  }

  return result;
}
