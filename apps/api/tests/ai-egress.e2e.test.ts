import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { expect, test } from "vitest";
import { databaseLayer } from "../src/db/connection";
import {
  openAiEgress,
  classifyAiCounterparty,
  readAiEgressLog,
} from "../src/application/ai-egress";
import { azureInvoiceReader } from "../src/adapters/document-reading/azure";
import { configuredDecisionModel } from "../src/runtime/decision-model";
import { database, environment, fixture } from "./support/fixtures";

const providerRelease = "synthetic-egress-model-v1";

const response = {
  model: providerRelease,
  usage: { input_tokens: 10, output_tokens: 1 },
  answers: {
    kind: {
      type: "choice",
      choice: "invoice",
      probabilities: { invoice: 1, unknown: 0 },
      confidence: 1,
    },
  },
};

function services() {
  return databaseLayer({
    connectionString: Redacted.make(environment().runtimeUrl),
    applicationName: "ai-egress-e2e",
    connectTimeoutMs: 10000,
    statementTimeoutMs: 15000,
  });
}

test("configured provider receives stable stored-identity tokens and immutable disclosure admissions", async () => {
  const book = await fixture();
  const scope = { entityId: book.entityId, bookId: book.bookId };
  const admin = await database();
  const received: unknown[] = [];
  let output: unknown = response;

  const respond = async (
    incoming: import("node:http").IncomingMessage,
    outgoing: import("node:http").ServerResponse,
  ) => {
    const chunks: Buffer[] = [];

    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(JSON.stringify(output));
  };

  const server = createServer((incoming, outgoing) => {
    void respond(incoming, outgoing).catch(() => outgoing.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Fixture unavailable");

  const model = configuredDecisionModel({
    OPENERP_DECISION_MODEL: "local-systemone-fixture",
    OPENERP_DECISION_MODEL_RELEASE: providerRelease,
    OPENERP_DECISION_MODEL_ENDPOINT: `http://127.0.0.1:${address.port}/`,
  });

  if (!model) throw new Error("Fixture model disabled");

  try {
    await admin.query(
      "update openerp.entities set name='Synthetic Private Client AB' where id=$1",
      [book.entityId],
    );
    await admin.query(
      "insert into openerp.evidence(book_id,id,title,content,media_type,origin,sha256,created_by) values ($1,'egress_evidence','Synthetic classification','synthetic evidence','text/plain','synthetic',encode(sha256(convert_to('synthetic evidence','UTF8')),'hex'),$2)",
      [book.bookId, book.actorId],
    );
    await admin.query(
      "insert into openerp.owner_parties(book_id,id,source_key,evidence_id,body) values ($1,'private_owner','owner-ref','egress_evidence',$2::jsonb)",
      [book.bookId, JSON.stringify({ displayName: "Elin Synthetic", sourceKey: "owner-ref" })],
    );
    await admin.query("BEGIN");
    await admin.query(
      "insert into openerp.commerce_counterparties(book_id,id,external_key,role,current_revision) values ($1,'company_supplier','company-ref','supplier',1), ($1,'sole_supplier','sole-ref','supplier',1)",
      [book.bookId],
    );
    await admin.query(
      "insert into openerp.commerce_counterparty_revisions(book_id,counterparty_id,revision,evidence_id,body) values ($1,'company_supplier',1,'egress_evidence',$2::jsonb), ($1,'sole_supplier',1,'egress_evidence',$3::jsonb)",
      [
        book.bookId,
        JSON.stringify({ displayName: "Synthetic Telecom AB", externalKey: "company-ref" }),
        JSON.stringify({ displayName: "Sven Synthetic", externalKey: "sole-ref" }),
      ],
    );

    await admin.query("COMMIT");

    const input = {
      model: providerRelease,
      state:
        "Synthetic Private Client AB. Elin Synthetic and Elin Synthetics invoice. Sven Synthetic. Synthetic Telecom AB. 19900101-1234. 556677-8899. Amount 9007199254740993 account 1930 VAT 25 date 2026-10-10.",
      questions: {
        kind: {
          type: "choice" as const,
          instructions: "Elin Synthetic reviews Synthetic Private Client AB",
          criteria: { invoice: "Invoice", unknown: "Unknown" },
        },
      },
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* classifyAiCounterparty(book.token, scope, {
          counterpartyId: "company_supplier",
          revision: "1",
          kind: "company",
          evidenceId: "egress_evidence",
        });
        yield* classifyAiCounterparty(book.token, scope, {
          counterpartyId: "sole_supplier",
          revision: "1",
          kind: "sole_trader",
          evidenceId: "egress_evidence",
        });
        const egress = yield* openAiEgress(book.token, scope, "decision");
        const first = yield* Effect.tryPromise(() => model.decide(input, egress));
        expect(first).toMatchObject({ status: "validated" });

        if (first.status !== "validated") throw new Error("Fixture output refused");
        const secondSession = yield* openAiEgress(book.token, scope, "decision");
        expect((yield* Effect.tryPromise(() => model.decide(input, secondSession))).status).toBe(
          "validated",
        );
        expect(received[1]).toEqual(received[0]);

        const typed = yield* Effect.tryPromise(() =>
          model.decide(
            {
              ...input,
              state: [
                { kind: "text", value: "Elin Synthetic" },
                { kind: "amount", value: "199001011234" },
                { kind: "account", value: "1930" },
                { kind: "date", value: "2026-10-10" },
                { kind: "vat", value: "1/4" },
              ],
            },
            egress,
          ),
        );

        expect(typed.status).toBe("validated");
        expect(JSON.stringify(received[2])).toContain("199001011234");

        const nested = yield* Effect.tryPromise(() =>
          model.decide(
            { ...input, state: { invoice: { kind: "amount", value: "199001011234" } } },
            egress,
          ),
        );

        expect(nested.status).toBe("validated");
        expect(JSON.stringify(received[3])).not.toContain("199001011234");
        expect(JSON.stringify(received[3])).toContain("[PERSONAL_ID_");

        const encoded = JSON.stringify(received[0]);

        for (const name of [
          "Synthetic Private Client AB",
          "Elin Synthetic",
          "Sven Synthetic",
          "19900101-1234",
          "owner-ref",
          "sole-ref",
        ])
          expect(encoded).not.toContain(name);

        for (const value of [
          "Synthetic Telecom AB",
          "556677-8899",
          "9007199254740993",
          "1930",
          "25",
          "2026-10-10",
        ])
          expect(encoded).toContain(value);
        const personToken = encoded.match(/\[PERSON_[0-9]+\]/)?.[0];

        if (!personToken) throw new Error("No person token observed");
        expect(first.tokens.restoreIdentity({ kind: "PERSON", token: personToken })).toBe(
          "Elin Synthetic",
        );
        expect(() =>
          first.tokens.restoreIdentity({ kind: "CLIENT", token: personToken }),
        ).toThrow();
        expect(() =>
          first.tokens.renderTemplate([{ kind: "text", text: `Hej ${personToken}` }]),
        ).toThrow();
        expect(
          first.tokens.renderTemplate([
            { kind: "text", text: "Hej " },
            { kind: "identity", identity: { kind: "PERSON", token: personToken } },
          ]),
        ).toBe("Hej Elin Synthetic");
        output = { ...response, invented: "[PERSON_999999999]" };
        expect(yield* Effect.tryPromise(() => model.decide(input, egress))).toMatchObject({
          status: "failed",
          code: "egress_refused",
        });
        output = { ...response, invented: "[PERSON_" };
        expect(yield* Effect.tryPromise(() => model.decide(input, egress))).toMatchObject({
          status: "failed",
          code: "egress_refused",
        });
        const before = received.length;
        expect(
          yield* Effect.tryPromise(() =>
            model.decide({ ...input, state: "Hej [PERSON_1]" }, egress),
          ),
        ).toMatchObject({ status: "failed", code: "egress_refused" });
        expect(received).toHaveLength(before);
        yield* Effect.tryPromise(() =>
          admin.query("REVOKE INSERT ON openerp.ai_egress_admissions FROM openerp_runtime"),
        );

        try {
          expect(yield* Effect.tryPromise(() => model.decide(input, egress))).toMatchObject({
            status: "failed",
            code: "egress_refused",
          });
          expect(received).toHaveLength(before);
        } finally {
          yield* Effect.tryPromise(() =>
            admin.query("GRANT INSERT ON openerp.ai_egress_admissions TO openerp_runtime"),
          );
        }

        yield* Effect.tryPromise(() =>
          admin.query("delete from openerp.memberships where book_id=$1 and actor_id=$2", [
            book.bookId,
            book.actorId,
          ]),
        );
        expect(yield* Effect.tryPromise(() => model.decide(input, egress))).toMatchObject({
          status: "failed",
          code: "egress_refused",
        });
        expect(received).toHaveLength(before);
      }).pipe(Effect.provide(services())),
    );
    await admin.query(
      "insert into openerp.memberships(book_id,actor_id,role) values ($1,$2,'operator')",
      [book.bookId, book.actorId],
    );
    await admin.query(
      "insert into openerp.owner_parties(book_id,id,source_key,evidence_id,body) values ($1,'second_owner','second-owner-ref','egress_evidence',$2::jsonb)",
      [
        book.bookId,
        JSON.stringify({ displayName: "Elin Synthetic", sourceKey: "second-owner-ref" }),
      ],
    );
    await admin.query("BEGIN");
    await admin.query(
      "insert into openerp.commerce_counterparties(book_id,id,external_key,role,current_revision) values ($1,'client_named_supplier','client-named-ref','supplier',1)",
      [book.bookId],
    );
    await admin.query(
      "insert into openerp.commerce_counterparty_revisions(book_id,counterparty_id,revision,evidence_id,body) values ($1,'client_named_supplier',1,'egress_evidence',$2::jsonb)",
      [
        book.bookId,
        JSON.stringify({
          displayName: "Synthetic Private Client AB",
          externalKey: "client-named-ref",
        }),
      ],
    );
    await admin.query("COMMIT");
    output = response;
    await Effect.runPromise(
      Effect.gen(function* () {
        const egress = yield* openAiEgress(book.token, scope, "decision");
        const before = received.length;
        expect(yield* Effect.tryPromise(() => model.decide(input, egress))).toMatchObject({
          status: "failed",
          code: "egress_refused",
        });
        expect(received).toHaveLength(before);

        const clientOnly = {
          ...input,
          state: "Synthetic Private Client AB",
          questions: { kind: { ...input.questions.kind, instructions: "Classify the invoice" } },
        };

        expect((yield* Effect.tryPromise(() => model.decide(clientOnly, egress))).status).toBe(
          "validated",
        );
        expect(JSON.stringify(received[before])).toContain("[CLIENT_");
        expect(JSON.stringify(received[before])).not.toContain("[SUPPLIER_");
      }).pipe(Effect.provide(services())),
    );

    const audit = await Effect.runPromise(
      readAiEgressLog(book.token, scope).pipe(Effect.provide(services())),
    );

    expect(audit).toHaveLength(7);
    expect(audit[2]!.categories).toContain("financial_facts");
    expect(audit[3]!.categories).not.toContain("financial_facts");
    expect(audit[0]).toMatchObject({
      provider: "http-systemone",
      modelRelease: providerRelease,
      disclosure: "tokenised",
    });
    expect(audit.every((entry) => entry.recordedAt && entry.categories.includes("free_text"))).toBe(
      true,
    );
    await expect(
      admin.query(
        "update openerp.ai_egress_admissions set model_release='forged' where book_id=$1",
        [book.bookId],
      ),
    ).rejects.toThrow();

    const artifact = JSON.stringify(
      {
        syntheticOnly: true,
        received,
        audit,
        revokedCallPrevented: true,
        unknownTokenRefused: true,
        typedRestorationVerified: true,
      },
      null,
      2,
    );

    expect(artifact).not.toContain("Elin Synthetic");
    expect(artifact).not.toContain(book.token);
    await writeFile(join(environment().artifacts, "ai-egress.json"), artifact);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await admin.end();
  }
});

test("book scope, retained aliases and failed audit storage fence real disclosure", async () => {
  const book = await fixture();
  const other = await fixture();
  const admin = await database();

  const provider = {
    provider: "synthetic-boundary",
    destination: "http://127.0.0.1",
    modelRelease: providerRelease,
    policy: "local-fixture" as const,
    approval: "synthetic-only",
  };

  const scope = { entityId: book.entityId, bookId: book.bookId };

  try {
    await admin.query('insert into openerp_auth."user"(id,name,email) values ($1,$2,$3)', [
      book.actorId,
      "Synthetic Profile Person",
      "profile-person@synthetic.invalid",
    ]);
    await Effect.runPromise(
      Effect.gen(function* () {
        const egress = yield* openAiEgress(book.token, scope, "agent");

        const first = yield* Effect.tryPromise(() =>
          egress.structured(
            provider,
            "Synthetic E2E entity. Synthetic Profile Person. profile-person@synthetic.invalid",
            ["free_text"],
          ),
        );

        const encoded = JSON.stringify(first.payload);
        expect(encoded).not.toContain("Synthetic Profile Person");
        expect(encoded).not.toContain("profile-person@");
        const clientToken = encoded.match(/\[CLIENT_[0-9]+\]/)?.[0];
        const personToken = encoded.match(/\[PERSON_[0-9]+\]/)?.[0];

        if (!clientToken || !personToken) throw new Error("Identity tokens missing");

        yield* Effect.tryPromise(() =>
          admin.query(
            "update openerp.entities set name='Synthetic Renamed Client AB' where id=$1",
            [book.entityId],
          ),
        );
        yield* Effect.tryPromise(() =>
          admin.query('update openerp_auth."user" set name=$2,email=$3 where id=$1', [
            book.actorId,
            "Synthetic Renamed Profile",
            "renamed@synthetic.invalid",
          ]),
        );

        const next = yield* Effect.tryPromise(() =>
          egress.structured(
            provider,
            "Synthetic E2E entity. Synthetic Renamed Client AB. Synthetic Profile Person. Synthetic Renamed Profile. profile-person@synthetic.invalid",
            ["free_text"],
          ),
        );

        expect(next.payload).toBe(
          `${clientToken}. ${clientToken}. ${personToken}. ${personToken}. ${personToken}`,
        );
        expect(next.registry.restoreIdentity({ kind: "CLIENT", token: clientToken })).toBe(
          "Synthetic Renamed Client AB",
        );

        const otherScope = { entityId: other.entityId, bookId: other.bookId };
        const otherEgress = yield* openAiEgress(other.token, otherScope, "agent");

        const otherCaptures = yield* Effect.tryPromise(() =>
          Promise.all([
            otherEgress.structured(provider, "Synthetic E2E entity", ["free_text"]),
            otherEgress.structured(provider, "Synthetic E2E entity", ["free_text"]),
          ]),
        );

        expect(otherCaptures[0]!.payload).toBe(otherCaptures[1]!.payload);

        const otherCapture = otherCaptures[0]!;

        expect(otherCapture.payload).not.toBe(clientToken);
        expect(() =>
          otherCapture.registry.restoreIdentity({ kind: "CLIENT", token: clientToken }),
        ).toThrow();

        const concurrent = yield* Effect.tryPromise(() =>
          Promise.all([
            egress.structured(provider, "Synthetic E2E entity", ["free_text"]),
            egress.structured(provider, "Synthetic Renamed Client AB", ["free_text"]),
          ]),
        );

        expect(concurrent.map((capture) => capture.payload)).toEqual([clientToken, clientToken]);
        yield* Effect.tryPromise(() =>
          admin.query("REVOKE INSERT ON openerp.ai_egress_admissions FROM openerp_runtime"),
        );

        try {
          yield* Effect.tryPromise(() =>
            expect(
              egress.structured(provider, "Synthetic Renamed Client AB", ["free_text"]),
            ).rejects.toThrow(),
          );
        } finally {
          yield* Effect.tryPromise(() =>
            admin.query("GRANT INSERT ON openerp.ai_egress_admissions TO openerp_runtime"),
          );
        }

        const audit = yield* readAiEgressLog(book.token, scope);
        expect(audit).toHaveLength(4);
        const tail = yield* readAiEgressLog(book.token, scope, audit[0]!.sequence);
        expect(tail).toEqual(audit.slice(1));
        yield* Effect.tryPromise(() =>
          writeFile(
            join(environment().artifacts, "ai-egress-scope.json"),
            JSON.stringify(
              {
                syntheticOnly: true,
                first: first.payload,
                next: next.payload,
                other: otherCapture.payload,
                audit,
                auditFailureRefused: true,
              },
              null,
              2,
            ),
          ),
        );
      }).pipe(Effect.provide(services())),
    );
  } finally {
    await admin.query("GRANT INSERT ON openerp.ai_egress_admissions TO openerp_runtime");
    await admin.end();
  }
});

test("raw document admission enforces policy and records submit and poll separately", async () => {
  const book = await fixture();
  const scope = { entityId: book.entityId, bookId: book.bookId };
  const received: string[] = [];

  const server = createServer((incoming, outgoing) => {
    received.push(incoming.method ?? "");
    incoming.resume();

    if (incoming.method === "POST") {
      outgoing.writeHead(202, {
        "operation-location": `${endpoint}/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/synthetic-operation?api-version=2024-11-30`,
      });
      outgoing.end();
    } else {
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ status: "succeeded" }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  const endpoint = `http://127.0.0.1:${address.port}`;

  const policy = {
    provider: "azure-document-intelligence",
    destination: endpoint,
    modelRelease: "prebuilt-invoice:2024-11-30",
    policy: "local-fixture" as const,
    approval: "synthetic-only",
  };

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const egress = yield* openAiEgress(book.token, scope, "document");
        const denied = azureInvoiceReader(endpoint, "synthetic-key", { ...policy, approval: "" });
        const bytes = new TextEncoder().encode("synthetic original with Synthetic Private Person");
        yield* Effect.tryPromise(() => expect(denied.submit(bytes, egress)).rejects.toThrow());
        expect(received).toHaveLength(0);
        const reader = azureInvoiceReader(endpoint, "synthetic-key", policy);
        const agentEgress = yield* openAiEgress(book.token, scope, "agent");
        yield* Effect.tryPromise(() => expect(reader.submit(bytes, agentEgress)).rejects.toThrow());
        expect(received).toHaveLength(0);
        const operation = yield* Effect.tryPromise(() => reader.submit(bytes, egress));
        expect(yield* Effect.tryPromise(() => reader.poll(operation, egress))).toEqual({
          status: "succeeded",
        });
        expect(received).toEqual(["POST", "GET"]);
        const audit = yield* readAiEgressLog(book.token, scope);
        expect(audit.map((entry) => entry.disclosure)).toEqual([
          "raw_document",
          "operation_reference",
        ]);

        const artifact = JSON.stringify(
          { syntheticOnly: true, audit, received, unapprovedPolicyPrevented: true },
          null,
          2,
        );

        expect(artifact).not.toContain("Synthetic Private Person");
        expect(artifact).not.toContain("synthetic-key");
        yield* Effect.tryPromise(() =>
          writeFile(join(environment().artifacts, "ai-egress-raw.json"), artifact),
        );
      }).pipe(Effect.provide(services())),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
