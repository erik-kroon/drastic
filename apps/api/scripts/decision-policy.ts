import { randomUUID } from "node:crypto";
import { Client } from "pg";
import * as Schema from "effect/Schema";
import { DecisionPolicy } from "@open-erp/contracts/decision-jobs";

const connectionString = process.env.OPENERP_DECISION_POLICY_DATABASE_URL;

const args = process.argv.slice(2);

const [bookId, questionId, mode, modelRelease] = args;

const budget = args[4];

const requestedModel = args[5] ?? modelRelease;

const expectedReportedModel = args[6] ?? requestedModel;

if (
  !connectionString ||
  connectionString === process.env.DATABASE_URL ||
  !bookId ||
  questionId !== "document_kind" ||
  !modelRelease?.trim() ||
  !requestedModel?.trim() ||
  !expectedReportedModel?.trim()
)
  throw new Error(
    "Use separate privileged OPENERP_DECISION_POLICY_DATABASE_URL and book/question/off|shadow/release/dispatch-budget/[selector]/[reported-model]. Synthetic fixture policy only.",
  );

const policy = Schema.decodeUnknownSync(DecisionPolicy)({
  id: `decision_policy_${randomUUID().replaceAll("-", "")}`,
  questionId,
  mode,
  modelRelease,
  requestedModel,
  expectedReportedModel,
  dispatchBudget: Number(budget),
  dataUse: "synthetic_fixture_only",
});

const client = new Client({ connectionString });

await client.connect();

try {
  await client.query("BEGIN");
  const book = await client.query("SELECT id FROM openerp.books WHERE id=$1 FOR UPDATE", [bookId]);

  if (book.rowCount !== 1) throw new Error("Book not found.");
  await client.query(
    "INSERT INTO openerp.book_decision_policies(book_id,id,question_id,body) VALUES($1,$2,$3,$4)",
    [bookId, policy.id, questionId, policy],
  );
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
