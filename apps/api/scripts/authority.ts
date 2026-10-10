import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";

// ADR 0020 operator console. The runtime role can read these records but cannot
// write them, so an agent operating the application cannot mint its own
// enrollment ticket or relax a book's authority policy.

const usage = `Usage with DATABASE_ADMIN_URL set:
  bun scripts/authority.ts presence-ticket <actor-id> [minutes]
  bun scripts/authority.ts policy <book-id> <presence: required|off> <mandates: enabled|off>`;

const connectionString = process.env.DATABASE_ADMIN_URL;

const [command, subject, first, second] = process.argv.slice(2);

if (!connectionString || !command || !subject) throw new Error(usage);

const client = new Client({ connectionString });

await client.connect();

try {
  if (command === "presence-ticket") {
    const minutes = first === undefined ? 30 : Number(first);

    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
      throw new Error("Use a ticket lifetime of 1–1440 minutes.");

    const ticket = randomBytes(36).toString("base64url");

    await client.query(
      `INSERT INTO openerp.presence_enrollment_tickets(id, actor_id, ticket_hash, expires_at)
      VALUES ($1, $2, $3, clock_timestamp() + make_interval(mins => $4))`,
      [
        `presence_ticket_${randomUUID()}`,
        subject,
        createHash("sha256").update(ticket).digest("hex"),
        minutes,
      ],
    );
    // The ticket is shown once; only its hash is stored.
    console.log(ticket);
  } else if (command === "policy") {
    if ((first !== "required" && first !== "off") || (second !== "enabled" && second !== "off"))
      throw new Error(usage);

    await client.query(
      `INSERT INTO openerp.book_authority_policies(book_id, presence_required, posting_mandates_enabled)
      VALUES ($1, $2, $3)
      ON CONFLICT (book_id) DO UPDATE SET presence_required = excluded.presence_required,
        posting_mandates_enabled = excluded.posting_mandates_enabled, changed_at = clock_timestamp()`,
      [subject, first === "required", second === "enabled"],
    );
    console.log(`Book ${subject}: presence ${first}, posting mandates ${second}.`);
  } else throw new Error(usage);
} finally {
  await client.end();
}
