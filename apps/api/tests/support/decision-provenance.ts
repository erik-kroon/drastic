import { database, type BookFixture } from "./fixtures";

export async function provenanceRows(book: BookFixture) {
  const admin = await database();

  try {
    return (
      await admin.query<{
        bookId: string;
        decision_kind: string;
        decision_id: string;
        classification: string;
        body: unknown;
      }>(
        `select book_id as "bookId", decision_kind, decision_id, classification, body from openerp.decision_provenance where book_id=$1 order by decision_kind,decision_id`,
        [book.bookId],
      )
    ).rows;
  } finally {
    await admin.end();
  }
}
