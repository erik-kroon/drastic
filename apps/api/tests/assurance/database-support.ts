import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "pg";
import { expect } from "vitest";
import { database, environment, type BookFixture } from "../support/fixtures";

/** A wait is evidence only after PostgreSQL reports the requested blocked sessions. */
export async function waitForBlockedExecutors(observer: Client, blockerPid: number, count: number) {
  const deadline = Date.now() + 10_000;
  let seen: number[] = [];

  while (Date.now() < deadline) {
    const result = await observer.query<{ pid: number }>(
      `
      WITH RECURSIVE chain AS (
        SELECT a.pid AS origin, a.pid, ARRAY[a.pid] AS path, 0 AS depth
        FROM pg_stat_activity a WHERE a.usename = 'e2e_runtime' AND a.state = 'active'
        UNION ALL
        SELECT c.origin, b.pid, c.path || b.pid, c.depth + 1
        FROM chain c CROSS JOIN LATERAL unnest(pg_blocking_pids(c.pid)) b(pid)
        WHERE c.depth < 12 AND NOT b.pid = ANY(c.path)
      )
      SELECT DISTINCT origin AS pid FROM chain WHERE pid = $1 ORDER BY origin`,
      [blockerPid],
    );

    seen = result.rows.map((row) => row.pid);

    if (seen.length >= count) return seen;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(
    `Expected ${count} blocked runtime sessions rooted at test blocker ${blockerPid}; observed ${seen.length}`,
  );
}

export async function freshCommandCount(book: BookFixture, commandKey: string) {
  const db = await database();

  try {
    const rows = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM openerp.command_receipts WHERE book_id=$1 AND key=$2",
      [book.bookId, commandKey],
    );

    expect(rows.rows).toHaveLength(1);

    return rows.rows[0]?.count;
  } finally {
    await db.end();
  }
}

export async function rawVoucherRows(book: BookFixture) {
  const db = await database();

  try {
    return (
      await db.query<{
        voucher_id: string;
        ordinal: number;
        account_id: string;
        debit: string;
        credit: string;
      }>(
        `SELECT voucher_id, ordinal, account_id, debit_minor::text AS debit, credit_minor::text AS credit
       FROM openerp.journal_lines WHERE book_id=$1 ORDER BY voucher_id, ordinal`,
        [book.bookId],
      )
    ).rows;
  } finally {
    await db.end();
  }
}

export const faultTables = [
  "journal_lines",
  "execution_receipts",
  "outbox",
  "command_receipts",
] as const;

export type FaultTable = (typeof faultTables)[number] | "bank_allocation_legs";

const allowedFaultTables: ReadonlyArray<string> = [...faultTables, "bank_allocation_legs"];

/** Only installed after fixture preparation, on the disposable harness database. */
export async function injectScopedInsertFault(book: BookFixture, table: FaultTable) {
  if (!/^[a-z][a-z0-9_-]{2,127}$/.test(book.bookId) || !allowedFaultTables.includes(table))
    throw new Error("Unsafe fixture fault target");
  const name = `assurance_fault_${randomBytes(8).toString("hex")}`;
  const admin = await database();

  const extra =
    table === "journal_lines" || table === "bank_allocation_legs" ? " AND NEW.ordinal = 2" : "";

  let installed = false;

  try {
    await admin.query(`CREATE FUNCTION openerp.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.book_id = '${book.bookId}'${extra} THEN
        RAISE EXCEPTION 'assurance deliberate insert fault' USING ERRCODE='P0001';
      END IF; RETURN NEW; END $$`);
    await admin.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON openerp.${table} FOR EACH ROW EXECUTE FUNCTION openerp.${name}()`,
    );
    installed = true;
  } finally {
    if (!installed) {
      try {
        await admin.query(`DROP FUNCTION IF EXISTS openerp.${name}()`);
      } finally {
        await admin.end();
      }
    }
  }

  return async () => {
    try {
      await admin.query(`DROP TRIGGER IF EXISTS ${name} ON openerp.${table}`);
      await admin.query(`DROP FUNCTION IF EXISTS openerp.${name}()`);
    } finally {
      await admin.end();
    }
  };
}

export async function saveSanitizedJourney(name: string, value: unknown) {
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error("Unsafe artifact name");
  // Callers provide selected results only, never fixture objects/tokens or database URLs.
  await writeFile(
    join(environment().artifacts, `assurance-${name}.json`),
    JSON.stringify(value, null, 2),
  );
}

/** Cleanup must attempt every owned resource, even after an earlier cleanup fails. */
export async function cleanupOwned(actions: ReadonlyArray<() => Promise<unknown>>) {
  const failures: unknown[] = [];

  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length)
    throw new AggregateError(failures, "Assurance owned-resource cleanup failed");
}
