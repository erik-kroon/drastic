import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import * as Owners from "@open-erp/contracts/owner-register";
import * as Operations from "@open-erp/contracts/owner-operations";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import {
  database,
  decoded,
  environment,
  failure,
  fixture,
  key,
  post,
  request,
} from "./support/fixtures";

test.each(["shareholder_loan", "conditional_contribution", "unconditional_contribution"] as const)(
  "owner funding derives retained cash for %s without duplicating it",
  async (legalForm) => {
    const book = await fixture([
      {
        id: "account_owner",
        code: legalForm === "shareholder_loan" ? "2893" : "2093",
        name: legalForm === "shareholder_loan" ? "Owner loan" : "Owner contribution equity",
      },
    ]);

    const independent = await fixture();
    const reviewer = { ...book, token: independent.token, actorId: independent.actorId };
    const admin = await database();

    try {
      await admin.query(
        "insert into openerp.memberships(book_id,actor_id,role) values($1,$2,'operator')",
        [book.bookId, reviewer.actorId],
      );
    } finally {
      await admin.end();
    }

    const declaration = {
      kind: "synthetic_bank_statement_v1",
      statementIdentifier: key(),
      sourceBankAccountId: "synthetic_funding_bank",
      accountId: "account_bank",
      currency: "SEK",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      openingMinor: "0",
      closingMinor: "130000",
      completeness: { declaredComplete: true, basis: "Independent synthetic funding receipt" },
      rows: [
        {
          rowOrdinal: 1,
          providerId: key(),
          date: "2026-09-22",
          description: "Synthetic owner loan",
          amountMinor: "100000",
        },
        {
          rowOrdinal: 2,
          providerId: key(),
          date: "2026-09-22",
          description: "Second independent retained funding row",
          amountMinor: "30000",
        },
      ],
    };

    const source = await post(
      book,
      "/evidence",
      {
        title: "Original owner loan source",
        content: JSON.stringify(declaration),
        mediaType: "application/json",
        origin: "Independent funding fixture",
      },
      Accounting.Evidence,
    );

    const statement = await post(
      book,
      "/bank-statements",
      { ...declaration, evidenceId: source.id, existingMatches: [] },
      Bank.StatementImportReceipt,
    );

    const owner = await post(
      book,
      "/owner-register/owners",
      {
        sourceKey: key(),
        displayName: "Synthetic lender",
        dataNature: "synthetic_example",
        evidenceId: source.id,
        reason: "Retained owner identity",
      },
      Owners.Owner,
    );

    const input = {
      mode: legalForm === "shareholder_loan" ? "owner_loan" : "owner_contribution",
      ownerId: owner.id,
      controlAccountId: "account_owner",
      cashAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      postingDate: "2026-09-22",
      series: "A",
      reason: "Retained source-backed owner loan",
      evidence: {
        fundingEvidenceId: source.id,
        legalForm,
        reason: "Synthetic loan terms",
        statementId: statement.statement.id,
        rowOrdinal: 1,
      },
    };

    await failure(
      await request(book, "/owner-operations/reviews", {
        method: "POST",
        body: JSON.stringify({ ...input, amountMinor: "999999" }),
      }),
      422,
      "InvalidJournal",
    );
    await failure(
      await request(book, "/owner-operations/reviews", {
        method: "POST",
        body: JSON.stringify({ ...input, postingDate: "2026-09-23" }),
      }),
      409,
      "StaleDependency",
    );
    const foreign = await fixture();

    await failure(
      await request(book, "/owner-operations/reviews", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          evidence: { ...input.evidence, statementId: foreign.bookId },
        }),
      }),
      404,
      "NotFound",
    );

    const review = await post(
      book,
      "/owner-operations/reviews",
      input,
      Operations.OwnerOperationReview,
    );

    expect(review.ownerEffect.amountMinor).toBe("100000");

    const competing = await post(
      book,
      "/owner-operations/reviews",
      {
        ...input,
        reason: "Independent preparation competing for the same retained cash row",
      },
      Operations.OwnerOperationReview,
    );

    const competingApproval = await post(
      reviewer,
      `/owner-operations/reviews/${competing.id}/approvals`,
      { version: 1, digest: competing.digest },
      Operations.OwnerOperationApproval,
    );

    const approval = await post(
      reviewer,
      `/owner-operations/reviews/${review.id}/approvals`,
      { version: 1, digest: review.digest },
      Operations.OwnerOperationApproval,
    );

    const commandKey = key();

    const command = {
      method: "POST",
      headers: { "idempotency-key": commandKey },
      body: JSON.stringify({ version: 1, digest: review.digest, approvalId: approval.id }),
    };

    if (legalForm === "shareholder_loan") {
      const fault = await database();

      try {
        await fault.query(`create function openerp.synthetic_funding_match_failure() returns trigger
          language plpgsql as $$begin raise exception 'synthetic funding match checkpoint failure'; end$$`);
        await fault.query(`create trigger synthetic_funding_match_failure before insert on openerp.bank_matches
          for each row execute function openerp.synthetic_funding_match_failure()`);
        await failure(
          await request(book, `/owner-operations/reviews/${review.id}/execute`, command),
          500,
          "InternalError",
        );
        expect(
          (
            await fault.query(
              "select count(*)::int as count from openerp.vouchers where book_id=$1",
              [book.bookId],
            )
          ).rows,
        ).toEqual([{ count: 0 }]);
      } finally {
        await fault.query(
          "drop trigger if exists synthetic_funding_match_failure on openerp.bank_matches",
        );
        await fault.query("drop function if exists openerp.synthetic_funding_match_failure()");
        await fault.end();
      }
    }

    const result = await decoded(
      await request(book, `/owner-operations/reviews/${review.id}/execute`, command),
      Operations.OwnerOperationReceipt,
    );

    expect(result.ownerClaimMinor).toBe(legalForm === "shareholder_loan" ? "100000" : "0");
    expect(result.recordedAmountMinor).toBe("100000");
    await failure(
      await request(book, `/owner-operations/reviews/${competing.id}/execute`, {
        method: "POST",
        body: JSON.stringify({
          version: 1,
          digest: competing.digest,
          approvalId: competingApproval.id,
        }),
      }),
      409,
      "StaleDependency",
    );
    expect(
      await decoded(
        await request(book, `/owner-operations/reviews/${review.id}/execute`, command),
        Operations.OwnerOperationReceipt,
      ),
    ).toEqual(result);
    await failure(
      await request(book, "/owner-operations/reviews", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      409,
      "AlreadyPosted",
    );
    const inspect = await database();

    try {
      expect(
        (
          await inspect.query(
            "select count(*)::int as count from openerp.bank_matches where book_id=$1 and statement_id=$2",
            [book.bookId, statement.statement.id],
          )
        ).rows,
      ).toEqual([{ count: 1 }]);
      expect(
        (
          await inspect.query(
            "select account_id,sum(debit_minor)::text as debit,sum(credit_minor)::text as credit from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
            [book.bookId],
          )
        ).rows,
      ).toEqual([
        { account_id: "account_bank", debit: "100000", credit: "0" },
        { account_id: "account_owner", debit: "0", credit: "100000" },
      ]);
    } finally {
      await inspect.end();
    }

    const repaymentSource = {
      ...declaration,
      statementIdentifier: key(),
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      openingMinor: "100000",
      closingMinor: "60000",
      rows: [
        {
          rowOrdinal: 1,
          providerId: key(),
          date: "2026-10-22",
          description: "Synthetic partial loan repayment",
          amountMinor: "-40000",
        },
      ],
    };

    const repaymentEvidence = await post(
      book,
      "/evidence",
      {
        title: "Original partial loan repayment",
        content: JSON.stringify(repaymentSource),
        mediaType: "application/json",
        origin: "Independent repayment fixture",
      },
      Accounting.Evidence,
    );

    const repaymentStatement = await post(
      book,
      "/bank-statements",
      { ...repaymentSource, evidenceId: repaymentEvidence.id, existingMatches: [] },
      Bank.StatementImportReceipt,
    );

    const repaymentInput = {
      mode: "repay_owner_loan",
      ownerId: owner.id,
      controlAccountId: "account_owner",
      cashAccountId: "account_bank",
      accountingPeriodId: "period_2026",
      postingDate: "2026-10-22",
      series: "A",
      reason: "Partial retained-source loan repayment",
      evidence: {
        cashEvidenceId: repaymentEvidence.id,
        statementId: repaymentStatement.statement.id,
        rowOrdinal: 1,
        loanEffectId: result.ownerEffectId,
        reason: "Repay only the retained original loan capacity",
      },
    };

    if (legalForm !== "shareholder_loan") {
      await failure(
        await request(book, "/owner-operations/reviews", {
          method: "POST",
          body: JSON.stringify(repaymentInput),
        }),
        422,
        "InvalidJournal",
      );
    } else {
      const excessSource = {
        ...repaymentSource,
        statementIdentifier: key(),
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        openingMinor: "200000",
        closingMinor: "60000",
        rows: [
          {
            ...repaymentSource.rows[0],
            providerId: key(),
            date: "2026-11-22",
            amountMinor: "-140000",
          },
        ],
      };

      const excessEvidence = await post(
        book,
        "/evidence",
        {
          title: "Oversized retained repayment",
          content: JSON.stringify(excessSource),
          mediaType: "application/json",
          origin: "Independent overcapacity fixture",
        },
        Accounting.Evidence,
      );

      const excessStatement = await post(
        book,
        "/bank-statements",
        { ...excessSource, evidenceId: excessEvidence.id, existingMatches: [] },
        Bank.StatementImportReceipt,
      );

      await failure(
        await request(book, "/owner-operations/reviews", {
          method: "POST",
          body: JSON.stringify({
            ...repaymentInput,
            postingDate: "2026-11-22",
            evidence: {
              ...repaymentInput.evidence,
              cashEvidenceId: excessEvidence.id,
              statementId: excessStatement.statement.id,
            },
          }),
        }),
        409,
        "StaleDependency",
      );

      const repayment = await post(
        book,
        "/owner-operations/reviews",
        repaymentInput,
        Operations.OwnerOperationReview,
      );

      expect(repayment.ownerEffect.classification).toBe("loan_repayment");
      expect(repayment.ownerEffect.amountMinor).toBe("40000");

      const approved = await post(
        reviewer,
        `/owner-operations/reviews/${repayment.id}/approvals`,
        { version: 1, digest: repayment.digest },
        Operations.OwnerOperationApproval,
      );

      const repaymentKey = key();

      const repaymentCommand = {
        method: "POST",
        headers: { "idempotency-key": repaymentKey },
        body: JSON.stringify({ version: 1, digest: repayment.digest, approvalId: approved.id }),
      };

      const repaid = await decoded(
        await request(book, `/owner-operations/reviews/${repayment.id}/execute`, repaymentCommand),
        Operations.OwnerOperationReceipt,
      );

      expect(repaid.reimburses).toEqual([{ claimId: result.ownerEffectId, amountMinor: "40000" }]);
      expect(
        await decoded(
          await request(
            book,
            `/owner-operations/reviews/${repayment.id}/execute`,
            repaymentCommand,
          ),
          Operations.OwnerOperationReceipt,
        ),
      ).toEqual(repaid);
      const final = await database();

      try {
        expect(
          (
            await final.query(
              "select account_id,(sum(debit_minor)-sum(credit_minor))::text as balance from openerp.journal_lines where book_id=$1 group by account_id order by account_id",
              [book.bookId],
            )
          ).rows,
        ).toEqual([
          { account_id: "account_bank", balance: "60000" },
          { account_id: "account_owner", balance: "-60000" },
        ]);
      } finally {
        await final.end();
      }

      const control = await post(
        book,
        "/owner-register/controls",
        { ownerId: owner.id, startsOn: "2026-01-01", endsOn: "2026-12-31" },
        Owners.Control,
      );

      expect(control.ownerBalances).toEqual([
        {
          accountId: "account_owner",
          recordedNetCreditMinor: "60000",
          openExpenseMinor: "0",
          openLoanMinor: "60000",
          unappliedReimbursementMinor: "0",
          unappliedLoanRepaymentMinor: "0",
          conditionalContributionMinor: "0",
          unconditionalContributionMinor: "0",
        },
      ]);
      expect(control.accountControls[0]?.unexplainedMinor).toBe("0");

      const mcp = await decoded(
        await fetch(`${environment().baseUrl}/api/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${book.agentToken}`,
            "content-type": "application/json",
            "MCP-Protocol-Version": "2025-11-25",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "owners_get_operation",
              arguments: {
                scope: { entityId: book.entityId, bookId: book.bookId },
                id: repayment.id,
              },
            },
          }),
        }),
        Schema.Struct({
          result: Schema.Struct({
            structuredContent: Schema.Struct({
              result: Operations.OwnerOperationView,
            }),
          }),
        }),
      );

      expect(mcp.result.structuredContent.result.result).toEqual(repaid);

      await writeFile(
        join(environment().artifacts, "owner-loan-partial-repayment.json"),
        JSON.stringify(
          { original: result, repayment, repaid, control, expectedRemainingMinor: "60000" },
          null,
          2,
        ),
      );
    }

    const secondReview = await post(
      book,
      "/owner-operations/reviews",
      {
        ...input,
        reason: "Admit the second unused row from the same retained original",
        evidence: { ...input.evidence, rowOrdinal: 2 },
      },
      Operations.OwnerOperationReview,
    );

    expect(secondReview.ownerEffect.amountMinor).toBe("30000");

    const secondApproval = await post(
      reviewer,
      `/owner-operations/reviews/${secondReview.id}/approvals`,
      { version: 1, digest: secondReview.digest },
      Operations.OwnerOperationApproval,
    );

    const secondResult = await post(
      book,
      `/owner-operations/reviews/${secondReview.id}/execute`,
      { version: 1, digest: secondReview.digest, approvalId: secondApproval.id },
      Operations.OwnerOperationReceipt,
    );

    expect(secondResult.recordedAmountMinor).toBe("30000");

    const sourceControl = await post(
      book,
      "/owner-register/controls",
      { ownerId: owner.id, startsOn: "2026-01-01", endsOn: "2026-12-31" },
      Owners.Control,
    );

    expect(sourceControl.accountControls[0]?.unexplainedMinor).toBe("0");
    expect(sourceControl.ownerBalances[0]?.recordedNetCreditMinor).toBe(
      legalForm === "shareholder_loan" ? "90000" : "130000",
    );
    await writeFile(
      join(environment().artifacts, `owner-funding-${legalForm}-retained-source.json`),
      JSON.stringify(
        {
          statement,
          review,
          result,
          secondReview,
          secondResult,
          sourceControl,
          expectedFirstMinor: "100000",
          expectedSecondMinor: "30000",
        },
        null,
        2,
      ),
    );
  },
);
