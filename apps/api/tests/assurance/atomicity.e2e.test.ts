import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import * as Recovery from "@open-erp/contracts/posting-recovery";
import * as Accounting from "@open-erp/contracts/accounting";
import {
  approve,
  decoded,
  emptyPosting,
  execution,
  fixture,
  failure,
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
  retainedPostingCounts,
  retainedPostingLinks,
  saveSanitizedJourney,
} from "./database-support";

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
      expect(await retainedPostingCounts(book)).toEqual({ groupReceipts: 0, consumptions: 0 });
      expect(await retainedPostingLinks(book, commandKey)).toEqual([]);
      await failure(await request(book, `/receipts/${commandKey}`), 404, "NotFound");

      const requestRecovery = await decoded(
        await request(book, `/posting-requests/${commandKey}`),
        Recovery.RecoveredPostingRequest,
      );

      expect(requestRecovery.state).toBe("not_observed");

      const recovery = await decoded(
        await request(book, `/posting-recovery/${plan.id}`),
        Recovery.PostingRecovery,
      );

      expect(recovery.summary.executionReceipt).toBeNull();
      expect(recovery.approvalConsumptions).toEqual([]);
    } finally {
      await removeFault();
    }

    const receipt = await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    );

    expect(await persisted(book)).toEqual(onePosting);
    expect(await freshCommandCount(book, commandKey)).toBe(1);
    expect(await retainedPostingCounts(book)).toEqual({ groupReceipts: 1, consumptions: 1 });

    const action = plan.groups[0]?.actions[0];
    const group = plan.groups[0];

    if (action === undefined || group === undefined) throw new Error("Missing exact posting group");

    const voucher = await decoded(
      await request(book, `/vouchers/${receipt.voucherId}`),
      Accounting.Voucher,
    );

    expect(voucher.action).toEqual(action);

    for (const reference of voucher.action.evidenceRefs) {
      const source = await decoded(
        await request(book, `/evidence/${reference.evidenceId}`),
        Accounting.EvidenceContent,
      );

      expect(source.sha256).toBe(reference.sha256);
      expect(createHash("sha256").update(source.content, "utf8").digest("hex")).toBe(
        reference.sha256,
      );
    }

    expect(
      await decoded(await request(book, `/receipts/${commandKey}`), Accounting.ExecutionReceipt),
    ).toEqual(receipt);
    expect(voucher.sequence).toBe("1");
    expect(voucher.number).toBe("1");

    const recovery = await decoded(
      await request(book, `/posting-recovery/${plan.id}`),
      Recovery.PostingRecovery,
    );

    expect(recovery.plan).toEqual(plan);
    expect(recovery.summary.executionReceipt).toEqual(receipt);
    expect(recovery.approvalConsumptions).toHaveLength(1);
    expect(recovery.approvalConsumptions[0]).toMatchObject({
      approvalId: approval.id,
      groupId: group.id,
      receiptId: receipt.id,
      approverBasis: { actorId: book.actorId, permission: "approve_change", scope: plan.scope },
      executorBasis: { actorId: book.actorId, permission: "execute_change", scope: plan.scope },
    });
    expect(recovery.requests.find((item) => item.key === commandKey)).toMatchObject({
      operation: "execute_change",
      actorId: book.actorId,
      resultId: receipt.id,
      planDigest: plan.planDigest,
    });
    const links = await retainedPostingLinks(book, commandKey);

    expect(links).toEqual([
      {
        key: commandKey,
        operation: "execute_change",
        commandActorId: book.actorId,
        commandResult: receipt,
        executionReceipt: receipt,
        approvalId: approval.id,
        groupId: group.id,
        planDigest: plan.planDigest,
        groupReceipt: {
          id: receipt.id,
          changeSetId: plan.id,
          groupId: group.id,
          planDigest: plan.planDigest,
          executionReceipts: [receipt],
          committedAt: receipt.committedAt,
        },
        approverId: book.actorId,
        executorId: book.actorId,
        consumptionReceiptId: receipt.id,
        voucherId: receipt.voucherId,
        periodId: action.accountingPeriodId,
        postingDate: action.postingDate,
        sequence: "1",
        approvalDigest: plan.planDigest,
        storedPlanDigest: plan.planDigest,
        outboxPayload: receipt,
      },
    ]);

    const replay = await decoded(
      await request(book, `/change-sets/${plan.id}/execute`, command),
      Accounting.ExecutionReceipt,
    );

    expect(replay).toEqual(receipt);
    expect(await retainedPostingCounts(book)).toEqual({ groupReceipts: 1, consumptions: 1 });
    expect(await retainedPostingLinks(book, commandKey)).toEqual(links);
    expect(await persisted(book)).toEqual(onePosting);
    await saveSanitizedJourney(`atomic-${table}`, {
      table,
      bookId: book.bookId,
      commandKey,
      receipt,
      voucher,
      recovery,
      links,
      persisted: await persisted(book),
    });
  },
);
