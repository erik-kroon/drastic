import { sql } from "drizzle-orm";
import { accounts, fiscalYears, periods } from "./schema";
import type { Transaction } from "./transaction";
import type * as Setup from "@open-erp/contracts/company-setup";

export function readInitialLedgerState(transaction: Transaction, bookId: string) {
  return transaction.execute<{ readonly empty: boolean; readonly authority: string }>(
    sql`
      select b.authority,
        not (
          exists(select 1 from openerp.accounts where book_id=b.id)
          or exists(select 1 from openerp.fiscal_years where book_id=b.id)
          or exists(select 1 from openerp.periods where book_id=b.id)
          or exists(select 1 from openerp.vouchers where book_id=b.id)
          or exists(select 1 from openerp.historical_bases where book_id=b.id)
          or exists(select 1 from openerp.financial_opening_sets where book_id=b.id)
        ) as empty
      from openerp.books b where b.id=${bookId}
    `,
    "objects",
  );
}

export function insertFiscalYear(
  transaction: Transaction,
  setup: typeof Setup.NativeLedgerSetup.Type,
) {
  return transaction.insert(fiscalYears).values({
    bookId: setup.scope.bookId,
    ...setup.fiscalYear,
  });
}

export function insertMonthlyPeriods(
  transaction: Transaction,
  setup: typeof Setup.NativeLedgerSetup.Type,
) {
  return transaction.insert(periods).values(
    setup.periods.map((period) => ({
      bookId: setup.scope.bookId,
      fiscalYearId: setup.fiscalYear.id,
      ...period,
    })),
  );
}

export function insertNativeAccounts(
  transaction: Transaction,
  setup: typeof Setup.NativeLedgerSetup.Type,
) {
  return transaction
    .insert(accounts)
    .values(setup.accounts.map((account) => ({ bookId: setup.scope.bookId, ...account })));
}
