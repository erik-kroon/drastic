import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  approve,
  decoded,
  emptyPosting,
  execution,
  fixture,
  onePosting,
  persisted,
  prepare,
  request,
} from "../support/fixtures";
import {
  faultTables,
  freshCommandCount,
  injectScopedInsertFault,
  rawVoucherRows,
  saveSanitizedJourney,
} from "./database-support";

// Failure contracts precede implementation: any rejected phase leaves no posting-group
// artifact, does not consume the approval/counters and permits the exact same retry.
test.each(faultTables)(
  "[ASR-ATOMIC] failure at %s rolls back every owned effect",
  async (table) => {
    const book = await fixture();
    const plan = await prepare(book);
    const approval = await approve(book, plan);
    const commandKey = randomUUID();

    const command = {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify(execution(plan, approval)),
    };

    const removeFault = await injectScopedInsertFault(book, table);

    try {
      const response = await request(book, `/change-sets/${plan.id}/execute`, command);
      expect(response.status, await response.text()).toBe(500);
      expect(await persisted(book)).toEqual(emptyPosting);
      expect(await rawVoucherRows(book)).toEqual([]);
      expect(await freshCommandCount(book, commandKey)).toBe(0);
    } finally {
      await removeFault();
    }

    const receipt = await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    );

    expect(await persisted(book)).toEqual(onePosting);
    expect(await freshCommandCount(book, commandKey)).toBe(1);

    const replay = await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    );

    expect(replay).toEqual(receipt);
    expect(await persisted(book)).toEqual(onePosting);
    await saveSanitizedJourney(`atomic-${table}`, {
      table,
      bookId: book.bookId,
      commandKey,
      receipt,
      persisted: await persisted(book),
    });
  },
);
