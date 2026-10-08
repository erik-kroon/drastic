import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import * as Firms from "../../packages/contracts/src/firms";
import * as Workspace from "../../packages/contracts/src/workspace";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { signInSyntheticOperator } from "./synthetic-session";

test("firm access requests retain local scoped metadata without accounting powers", async ({
  app,
  browser,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const scopePath = new URL(workspace).pathname;
  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");

  const request = async (path: string, body?: unknown, key = randomUUID()) =>
    fetch(`${origin}/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

  const read = async (path: string) => {
    const response = await request(path);

    expect(response.status).toBe(200);

    return Schema.decodeUnknownSync(Schema.JsonObject)(await response.json());
  };

  const before = await read(`${scopePath}/ledger`);
  const booksBefore = await request("/books");

  expect(booksBefore.status).toBe(200);

  const books = Schema.decodeUnknownSync(Schema.Json)(await booksBefore.json());

  const actor = Schema.decodeUnknownSync(Workspace.Coordination)(
    await read(`${scopePath}/workspace`),
  );

  const create = await request("/firms", { name: "Synthetic pending-client bureau" });

  expect(create.status).toBe(200);

  const firm = Schema.decodeUnknownSync(Firms.CommandResult)(await create.json());
  const path = `/firms/${firm.firmId}/access-requests`;
  const key = randomUUID();

  const input = {
    id: "request_synthetic_pending",
    clientName: "Synthetic inaccessible client",
    organizationNumber: "5599999999",
    leadId: actor.actorId,
    state: "requested",
    expectedRevision: 0,
  };

  const save = await request(path, input, key);

  expect(save.status).toBe(200);

  const saved = Schema.decodeUnknownSync(Firms.CommandResult)(await save.json());
  const replay = await request(path, input, key);

  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(saved);

  const initial = await read(`/firms/${firm.firmId}`);

  expect(initial).toMatchObject({
    clients: [],
    accessRequests: [
      {
        id: input.id,
        clientName: input.clientName,
        organizationNumber: input.organizationNumber,
        leadId: actor.actorId,
        requestedBy: actor.actorId,
        state: "requested",
        revision: saved.revision,
      },
    ],
  });

  const conflict = await request(path, { ...input, clientName: "Changed declaration" }, key);
  const stale = await request(path, { ...input, state: "revoked" });
  const foreign = await request("/firms/firm_unavailable/access-requests", input);

  const extra = await request(path, {
    ...input,
    expectedRevision: saved.revision,
    scope: { entityId: "entity_synthetic", bookId: "book_synthetic" },
  });

  const missingLead = await request(path, {
    ...input,
    id: "request_other_member",
    leadId: "actor_unavailable",
  });

  expect(conflict.status).toBe(409);
  expect(stale.status).toBe(409);
  expect(foreign.status).toBe(403);
  expect(extra.status).toBe(400);
  expect(missingLead.status).toBe(422);
  expect(await read(`/firms/${firm.firmId}`)).toEqual(initial);

  const revoke = await request(path, {
    ...input,
    expectedRevision: saved.revision,
    state: "revoked",
  });

  expect(revoke.status).toBe(200);

  const revoked = Schema.decodeUnknownSync(Firms.CommandResult)(await revoke.json());
  const final = await read(`/firms/${firm.firmId}`);

  expect(revoked.revision).toBeGreaterThan(saved.revision);
  expect(final).toMatchObject({
    clients: [],
    accessRequests: [{ id: input.id, state: "revoked", revision: revoked.revision }],
  });

  const oldReplay = await request(path, input, key);

  expect(oldReplay.status).toBe(200);
  expect(await oldReplay.json()).toEqual(saved);
  expect(await read(`/firms/${firm.firmId}`)).toEqual(final);

  const reactivate = await request(path, { ...input, expectedRevision: revoked.revision });

  expect(reactivate.status).toBe(422);
  expect(await read(`/firms/${firm.firmId}`)).toEqual(final);
  expect(await read(`${scopePath}/ledger`)).toEqual(before);

  const booksAfter = await request("/books");

  expect(booksAfter.status).toBe(200);
  expect(await booksAfter.json()).toEqual(books);

  await writeFile(
    join(output, "firm-access-requests.json"),
    JSON.stringify(
      {
        scope: "Real public HTTP local firm request owner with synthetic human session",
        limits:
          "No browser request UI, external invitation delivery, owner access grant, other human actor, inactive member or inventory-boundary qualification. Requests declare metadata only and contain no financial facts.",
        initial,
        final,
        saved,
        revoked,
        books,
        before,
        failureStatuses: {
          conflict: conflict.status,
          stale: stale.status,
          foreign: foreign.status,
          extra: extra.status,
          missingLead: missingLead.status,
        },
      },
      null,
      2,
    ),
  );
});
