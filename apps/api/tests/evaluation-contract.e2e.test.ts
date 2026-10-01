import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Intake from "@open-erp/contracts/source-intake";
import { database, decoded, environment, fixture, key, request } from "./support/fixtures";

const Contract = Schema.Struct({
  id: Schema.String,
  digest: Schema.String,
  createdBy: Schema.String,
  state: Schema.Literal("contract_only"),
  wholeYearComplete: Schema.Literal(false),
  predecessor: Schema.NullOr(Schema.Struct({ id: Schema.String, digest: Schema.String })),
  originals: Schema.Array(Intake.SourceOccurrence),
  profile: Profiles.CompanyProfile,
  openingBasis: Schema.Struct({ status: Schema.Literal("unknown"), reason: Schema.String }),
  familyPopulation: Schema.Struct({ status: Schema.Literal("unknown"), reason: Schema.String }),
  capabilityPolicy: Schema.Literal("declared_not_enforced"),
});

const declaration = {
  recordClass: "synthetic",
  interval: { startsOn: "2026-01-01", endsOn: "2026-12-31" },
  openingBasis: { status: "unknown", reason: "Opening balances have not been reviewed." },
  familyPopulation: { status: "unknown", reason: "Full company population is not established." },
  permittedAssistance: ["original_fact_clarification", "required_human_approval"],
  allowedCapabilities: ["source_get_occurrence"],
  predecessor: null,
};

const retainedText = "Synthetic original. No accounting amounts or reference postings.";

function isArray(value: Schema.Json): value is Schema.JsonArray {
  return Array.isArray(value);
}

function canonical(value: Schema.Json): string {
  if (isArray(value)) return `[${value.map(canonical).join(",")}]`;

  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, member]) => `${JSON.stringify(name)}:${canonical(member)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function verifyContract(body: Schema.JsonObject) {
  const { digest, ...unsigned } = body;
  expect(digest).toBe(`sha256:${createHash("sha256").update(canonical(unsigned)).digest("hex")}`);
}

test("operator evaluation contracts retain incomplete inputs, exact replay and immutable successors", async () => {
  const book = await fixture();
  const other = await fixture();

  const original = await decoded(
    await request(book, "/source-occurrences", {
      method: "POST",
      body: JSON.stringify({
        sourceSystem: "synthetic-evaluation",
        sourceAccountId: "fixture",
        occurrenceKey: "original",
        sourceRevision: "1",
        filename: "synthetic.txt",
        mediaType: "text/plain",
        contentBase64: Buffer.from(retainedText).toString("base64"),
      }),
    }),
    Intake.SourceOccurrence,
  );

  const input = { ...declaration, originalIds: [original.id] };
  const replayKey = key();

  const exchanges: Array<{
    path: string;
    key: string;
    payload: Schema.Json;
    status: number;
    response: string;
  }> = [];

  const send = async (
    payload: unknown,
    commandKey = key(),
    target = book,
    token = target.token,
  ) => {
    const response = await request(target, "/evaluations/contracts", {
      method: "POST",
      headers: { "idempotency-key": commandKey, authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    exchanges.push({
      path: `${target.path}/evaluations/contracts`,
      key: commandKey,
      payload: Schema.decodeUnknownSync(Schema.Json)(payload),
      status: response.status,
      response: await response.clone().text(),
    });

    return response;
  };

  const [firstResponse, concurrentFirstResponse] = await Promise.all([
    send(input, replayKey),
    send(input, replayKey),
  ]);

  expect(firstResponse.status).toBe(200);
  const first = await decoded(firstResponse.clone(), Contract);

  const raw = Schema.decodeSync(Schema.fromJsonString(Schema.JsonObject))(
    await firstResponse.text(),
  );

  verifyContract(raw);

  expect(await concurrentFirstResponse.json()).toEqual(raw);
  expect(first.originals.map((item) => ({ id: item.id, sha256: item.sha256 }))).toEqual([
    {
      id: original.id,
      sha256: `sha256:${createHash("sha256").update(retainedText).digest("hex")}`,
    },
  ]);
  expect(
    first.profile.families.map((family) => ({
      family: family.family,
      status: family.status,
      witness: family.witness,
    })),
  ).toEqual(
    ["posting_eligibility", "vat", "payroll", "statements", "corporate_tax"].map((family) => ({
      family,
      status: "incomplete",
      witness: null,
    })),
  );

  expect(first.createdBy).toBe(book.actorId);
  expect(first.openingBasis).toEqual(declaration.openingBasis);
  expect(first.familyPopulation).toEqual(declaration.familyPopulation);
  expect(first.wholeYearComplete).toBe(false);
  expect(first.capabilityPolicy).toBe("declared_not_enforced");
  const concurrent = await Promise.all([send(input, replayKey), send(input, replayKey)]);

  for (const response of concurrent) expect(await response.json()).toEqual(raw);
  expect(await (await request(book, `/evaluations/contracts/${first.id}`)).json()).toEqual(raw);
  expect((await send({ ...input, permittedAssistance: [] }, replayKey)).status).toBe(409);
  const admin = await database();

  try {
    await admin.query(
      "INSERT INTO openerp.memberships(book_id, actor_id, role) VALUES ($1, $2, 'operator')",
      [book.bookId, other.actorId],
    );
    expect((await send(input, replayKey, book, other.token)).status).toBe(409);
    expect((await send(input, key(), book, book.agentToken)).status).toBe(403);
    expect(
      (
        await request(
          { ...book, path: `/api/v1/entities/${other.entityId}/books/${book.bookId}` },
          `/evaluations/contracts/${first.id}`,
        )
      ).status,
    ).toBe(403);
    expect((await send(input, key(), other)).status).toBe(404);
    expect((await send({ ...input, originalIds: Array(101).fill(original.id) })).status).toBe(400);
    expect((await send({ ...input, wholeYearComplete: true })).status).toBe(400);
    expect((await send({ ...input, allowedCapabilities: ["unknown_capability"] })).status).toBe(
      422,
    );
    expect(
      (await send({ ...input, predecessor: { id: first.id, digest: `sha256:${"0".repeat(64)}` } }))
        .status,
    ).toBe(409);

    const successorResponse = await send({
      ...input,
      predecessor: { id: first.id, digest: first.digest },
      permittedAssistance: ["required_human_approval"],
    });

    const successor = await decoded(successorResponse.clone(), Contract);

    const rawSuccessor = Schema.decodeSync(Schema.fromJsonString(Schema.JsonObject))(
      await successorResponse.text(),
    );

    verifyContract(rawSuccessor);

    expect(successor.predecessor).toEqual({ id: first.id, digest: first.digest });
    expect(successor.id).not.toBe(first.id);
    expect(await (await request(book, `/evaluations/contracts/${first.id}`)).json()).toEqual(raw);
    expect(
      (await send({ ...input, predecessor: { id: first.id, digest: first.digest } })).status,
    ).toBe(409);

    const counts = await admin.query(
      "SELECT count(*)::text AS count FROM openerp.evaluation_contracts WHERE book_id = $1",
      [book.bookId],
    );

    expect(counts.rows).toEqual([{ count: "2" }]);
    await admin.query(
      "UPDATE openerp.credentials SET expires_at = now() - interval '1 second' WHERE actor_id = $1",
      [book.actorId],
    );
    expect((await send(input, replayKey)).status).toBe(401);
    await admin.query(
      "UPDATE openerp.credentials SET expires_at = now() + interval '1 day', revoked_at = now() WHERE actor_id = $1",
      [book.actorId],
    );
    expect((await request(book, `/evaluations/contracts/${first.id}`)).status).toBe(401);
    await writeFile(
      join(environment().artifacts, "evaluation-contract.json"),
      JSON.stringify(
        {
          originalText: retainedText,
          input,
          first: raw,
          successor: rawSuccessor,
          exchanges,
          vectors: [
            "capture",
            "read",
            "lost-response",
            "concurrent-replay",
            "actor-conflict",
            "input-conflict",
            "operator-only",
            "cross-book-source",
            "overflow",
            "excess-property",
            "unknown-capability",
            "stale-predecessor",
            "immutable-successor",
            "single-successor",
            "expiry",
            "revocation",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.end();
  }
}, 120_000);
