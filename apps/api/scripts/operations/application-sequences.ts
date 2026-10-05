import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import * as Schema from "effect/Schema";
import { ApplicationSequence } from "@open-erp/contracts/operations";
import { refuse } from "./safety";

export const applicationSequenceTables = [
  "document_governance",
  "document_governance_reviews",
  "document_manifests",
  "document_signature_attempts",
  "document_signature_evidence",
  "document_signature_intents",
  "document_signature_observations",
  "document_validations",
  "filing_attempts",
  "filing_adoption_reviews",
  "filing_adoptions",
  "filing_authorizations",
  "filing_intents",
  "filing_observations",
];

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
    [applicationSequenceTables],
  );

  const expected = relations.rows.map((row) => ({
    name: `${row.table}_ordinal_seq`,
    table: row.table,
    column: "ordinal",
  }));

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
