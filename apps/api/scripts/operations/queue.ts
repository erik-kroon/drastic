import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import * as Schema from "effect/Schema";
import { QueueSequence } from "@open-erp/contracts/operations";
import { refuse } from "./safety";

export const queueTables = [
  "effect_mq_dedupe",
  "effect_mq_flow_children",
  "effect_mq_flow_outbox",
  "effect_mq_job_attempts",
  "effect_mq_jobs",
  "effect_mq_queue_control",
  "effect_mq_schedules",
];

const sequenceOwners = [
  { name: "effect_mq_flow_outbox_id_seq", table: "effect_mq_flow_outbox", column: "id" },
  { name: "effect_mq_jobs_seq_seq", table: "effect_mq_jobs", column: "seq" },
];

export async function readQueueSequences(client: Client) {
  const sequences = await client.query<{ name: string; table: string; column: string }>(`
    SELECT c.relname AS name, t.relname AS table, a.attname AS column
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_sequence s ON s.seqrelid=c.oid
    LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid
      AND d.refclassid='pg_class'::regclass AND d.refobjsubid>0 AND d.deptype IN ('a','i')
    LEFT JOIN pg_class t ON t.oid=d.refobjid AND t.relnamespace=n.oid
    LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
    WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      AND n.nspname='public' AND c.relpersistence='p' AND pg_get_userbyid(c.relowner)=current_user
      AND s.seqtypid='bigint'::regtype AND s.seqstart=1 AND s.seqincrement=1
      AND s.seqmin=1 AND s.seqmax=9223372036854775807 AND s.seqcache=1 AND NOT s.seqcycle
    ORDER BY c.relname COLLATE "C"`);

  const count = await client.query<{ count: string }>(`
    SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`);

  if (count.rows[0]?.count !== "2" || !isDeepStrictEqual(sequences.rows, sequenceOwners))
    refuse("Recovery supports only the two owned, noncycling effect-mq sequences.");

  const result: Array<typeof QueueSequence.Type> = [];

  for (const sequence of sequenceOwners) {
    const state = await client.query<{ lastValue: string; isCalled: boolean }>(
      `SELECT last_value::text AS "lastValue", is_called AS "isCalled" FROM public.${client.escapeIdentifier(sequence.name)}`,
    );

    result.push(Schema.decodeUnknownSync(QueueSequence)({ ...sequence, ...state.rows[0] }));
  }

  return result;
}
