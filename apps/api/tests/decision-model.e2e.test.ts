import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Schema from "effect/Schema";
import type * as D from "@open-erp/domain/decisions";
import { configuredDecisionModel } from "../src/runtime/decision-model";
import type {
  DecisionModel,
  DecisionOutcome,
  WorkersAi,
} from "../src/adapters/decision-models/systemone";
import { systemOneModel } from "../src/adapters/decision-models/systemone";
import { withAiEgress } from "./support/ai-egress";
import { environment, fixture } from "./support/fixtures";

const release = "synthetic_release_1";

const credential = "synthetic_credential_not_for_artifacts";

const request: D.SystemOneRequest = {
  model: release,
  state: "Synthetic prompt not for captured diagnostics",
  questions: {
    kind: {
      type: "choice",
      instructions: "Synthetic closed taxonomy",
      criteria: { invoice: "Synthetic invoice", unknown: "Insufficient evidence" },
    },
  },
};

function authoredResponse(model = release) {
  return {
    model,
    answers: {
      kind: {
        type: "choice",
        choice: "invoice",
        probabilities: { invoice: 0.9, unknown: 0.1 },
        confidence: 0.8,
      },
    },
    usage: { input_tokens: 7, output_tokens: 1 },
  };
}

async function loopbackFixture() {
  const counts: Record<string, number> = {};
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const server = createServer((incoming, outgoing) => {
    const name = (incoming.url ?? "/").slice(1);
    counts[name] = (counts[name] ?? 0) + 1;

    if (name === "headers") {
      timers.add(setTimeout(() => outgoing.end(JSON.stringify(authoredResponse())), 1500));

      return;
    }

    if (name === "rate") {
      outgoing.writeHead(429);
      outgoing.end("Synthetic rate limit");

      return;
    }

    if (name === "server") {
      outgoing.writeHead(503);
      outgoing.end("Synthetic failure");

      return;
    }

    outgoing.writeHead(200, { "content-type": "application/json" });

    if (name === "body" || name === "abort") {
      outgoing.write('{"model":');

      return;
    }

    if (name.startsWith("usage_"))
      outgoing.end(
        JSON.stringify({
          ...authoredResponse(),
          usage: { input_tokens: Number(name.slice(6)), output_tokens: 1 },
        }),
      );
    else if (name === "size") outgoing.end("x".repeat(1024 * 1024 + 1));
    else if (name === "duplicate") outgoing.end('{"model":"first","model":"second"}');
    else if (name === "utf8") outgoing.end(Buffer.from([0xff, 0xfe]));
    else if (name === "json") outgoing.end("{");
    else if (name === "model") outgoing.end(JSON.stringify(authoredResponse("wrong_release")));
    else if (name === "option") {
      const result = authoredResponse();
      outgoing.end(
        JSON.stringify({
          ...result,
          answers: { kind: { ...result.answers.kind, probabilities: { invoice: 1, foreign: 0 } } },
        }),
      );
    } else outgoing.end(JSON.stringify(authoredResponse()));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("Fixture has no TCP address");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    counts,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function required(model: DecisionModel | undefined) {
  if (model === undefined) throw new Error("Fixture model is disabled");

  return model;
}

test("decision adapter configuration and real HTTP wire retain bounded typed outcomes without retry", async () => {
  const book = await fixture();
  const local = await loopbackFixture();

  const base = {
    OPENERP_DECISION_MODEL: "local-systemone-fixture",
    OPENERP_DECISION_MODEL_RELEASE: release,
    OPENERP_DECISION_MODEL_ENDPOINT: `${local.origin}/valid`,
    OPENERP_DECISION_MODEL_TIMEOUT_MS: "250",
  };

  let bindingCalls = 0;

  const binding: WorkersAi = {
    async run() {
      bindingCalls++;

      return authoredResponse("clef-flash");
    },
  };

  try {
    expect(
      configuredDecisionModel({ OPENERP_DECISION_MODEL_KEY: credential }, binding),
    ).toBeUndefined();
    expect(
      configuredDecisionModel(
        { ...base, OPENERP_DECISION_MODEL: "disabled", OPENERP_DECISION_MODEL_KEY: credential },
        binding,
      ),
    ).toBeUndefined();
    expect(local.counts).toEqual({});
    expect(bindingCalls).toBe(0);

    const invalidConfigurations = [
      { ...base, OPENERP_DECISION_MODEL_RELEASE: undefined },
      { ...base, OPENERP_DECISION_MODEL_ENDPOINT: "http://example.invalid/decision" },
      { ...base, OPENERP_DECISION_MODEL_ENDPOINT: "https://127.0.0.1/decision" },
      { ...base, OPENERP_DECISION_MODEL_ENDPOINT: "http://user:secret@127.0.0.1/decision" },
      {
        ...base,
        OPENERP_DECISION_MODEL: "self-hosted-clef",
        OPENERP_DECISION_MODEL_KEY: credential,
      },
      {
        ...base,
        OPENERP_DECISION_MODEL: "self-hosted-clef",
        OPENERP_DECISION_MODEL_ENDPOINT: "https://synthetic.invalid/v1/systemone",
      },
      { ...base, OPENERP_DECISION_MODEL: "workers-ai-clef" },
      { ...base, OPENERP_DECISION_MODEL_TIMEOUT_MS: "0" },
      { ...base, OPENERP_DECISION_MODEL: "unknown-provider" },
    ];

    for (const config of invalidConfigurations)
      expect(() => configuredDecisionModel(config)).toThrow();

    expect(local.counts).toEqual({});
    const outcomes: Array<{ name: string; expected: string; observed: DecisionOutcome }> = [];

    const cases = [
      ["valid", "validated"],
      ["headers", "timeout"],
      ["body", "timeout"],
      ["rate", "rate_limited"],
      ["server", "http_error"],
      ["size", "response_size"],
      ["duplicate", "response_json"],
      ["utf8", "response_json"],
      ["json", "response_json"],
      ["model", "model_mismatch"],
      ["option", "invalid_response"],
    ] as const;

    for (const [name, expected] of cases) {
      const model = required(
        configuredDecisionModel({
          ...base,
          OPENERP_DECISION_MODEL_ENDPOINT: `${local.origin}/${name}`,
        }),
      );

      const observed = await withAiEgress(book, (egress) => model.decide(request, egress));

      expect(observed.status === "validated" ? observed.status : observed.code).toBe(expected);
      expect(local.counts[name]).toBe(1);
      outcomes.push({ name, expected, observed });
    }

    const success = outcomes[0]!.observed;

    if (success.status !== "validated") throw new Error("Valid HTTP distribution refused");

    expect(success.response).toEqual(authoredResponse());
    expect(success.claimStatus).toBe("unreviewed_source_claim");
    expect(success.identity).toMatchObject({
      configuredRelease: release,
      requestedModel: release,
      reportedModel: release,
      releaseQualification: "unsubstantiated",
    });
    expect(success.wireEvidence).toBe("bounded_utf8_unique_keys");
    const aborted = new AbortController();
    aborted.abort();

    const abortModel = required(
      configuredDecisionModel({
        ...base,
        OPENERP_DECISION_MODEL_ENDPOINT: `${local.origin}/abort`,
      }),
    );

    const beforeAbort = await withAiEgress(book, (egress) =>
      abortModel.decide(request, egress, aborted.signal),
    );

    expect(beforeAbort).toMatchObject({ status: "failed", code: "aborted" });
    expect(local.counts.abort).toBeUndefined();
    const during = new AbortController();

    const pending = withAiEgress(book, (egress) =>
      abortModel.decide(request, egress, during.signal),
    );

    const abortTimer = setTimeout(() => during.abort(), 50);
    const duringAbort = await pending;
    clearTimeout(abortTimer);

    expect(duringAbort).toMatchObject({ status: "failed", code: "aborted" });
    expect(local.counts.abort).toBe(1);

    const invalidRequest = await withAiEgress(book, (egress) =>
      required(configuredDecisionModel(base)).decide(
        {
          ...request,
          model: "different_selector",
        },
        egress,
      ),
    );

    expect(invalidRequest).toMatchObject({ status: "failed", code: "invalid_request" });
    expect(local.counts.valid).toBe(1);

    const artifact = {
      syntheticOnly: true,
      invalidConfigurationCount: invalidConfigurations.length,
      bindingCalls,
      counts: local.counts,
      outcomes,
      beforeAbort,
      duringAbort,
      invalidRequest,
    };

    const encoded = JSON.stringify(artifact, null, 2);

    expect(encoded).not.toContain(credential);
    expect(encoded).not.toContain(request.state);
    await writeFile(join(environment().artifacts, "decision-model-http.json"), encoded);
  } finally {
    await local.close();
  }
});

test("authored Workers AI binding exercises the shared validator without claiming live weight qualification or wire inspection", async () => {
  const book = await fixture();
  const calls: Array<{ selector: string; requestedModel: string }> = [];
  let output: unknown = authoredResponse("clef-flash");
  let stalls = false;

  const binding: WorkersAi = {
    async run(selector, input) {
      calls.push({ selector, requestedModel: input.model });

      if (stalls) return new Promise<never>(() => {});

      return output;
    },
  };

  const config = {
    OPENERP_DECISION_MODEL: "workers-ai-clef",
    OPENERP_AI_EGRESS_POLICY: "eu-no-training-no-retention",
    OPENERP_AI_EGRESS_APPROVAL: "synthetic-policy-not-live-qualification",
    OPENERP_DECISION_MODEL_RELEASE: "synthetic_clef_configuration_1",
    OPENERP_DECISION_MODEL_TIMEOUT_MS: "100",
  };

  const model = required(configuredDecisionModel(config, binding));
  const input = { ...request, model: "clef-flash" };
  const success = await withAiEgress(book, (egress) => model.decide(input, egress));

  expect(success.status).toBe("validated");

  if (success.status !== "validated") throw new Error("Authored binding distribution refused");

  expect(success.identity).toMatchObject({
    configuredRelease: config.OPENERP_DECISION_MODEL_RELEASE,
    requestedModel: "clef-flash",
    reportedModel: "clef-flash",
    workersAiSelector: "@cf/cloudflare/clef-flash",
    releaseQualification: "unsubstantiated",
  });
  expect(success.response).toEqual(authoredResponse("clef-flash"));
  expect(success.wireEvidence).toBe("already_parsed_object");

  const cases = [
    { name: "invalid", output: {}, expected: "invalid_response" },
    { name: "oversized", output: { text: "x".repeat(1024 * 1024 + 1) }, expected: "response_size" },
    { name: "wrong_model", output: authoredResponse("clef"), expected: "model_mismatch" },
  ];

  const outcomes: Array<{ name: string; expected: string; observed: DecisionOutcome }> = [];

  for (const item of cases) {
    output = item.output;
    const observed = await withAiEgress(book, (egress) => model.decide(input, egress));

    expect(observed).toMatchObject({ status: "failed", code: item.expected });
    outcomes.push({ name: item.name, expected: item.expected, observed });
  }

  stalls = true;
  const timedOut = await withAiEgress(book, (egress) => model.decide(input, egress));

  expect(timedOut).toMatchObject({ status: "failed", code: "timeout" });
  expect(calls).toHaveLength(5);
  expect(
    calls.every(
      (call) =>
        call.selector === "@cf/cloudflare/clef-flash" && call.requestedModel === "clef-flash",
    ),
  ).toBe(true);
  await writeFile(
    join(environment().artifacts, "decision-model-binding.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        authoredBindingNotLiveCloudflare: true,
        success,
        outcomes,
        timedOut,
        calls,
        remoteCancellationVerified: false,
        rawWireDuplicateKeysVerified: false,
      },
      null,
      2,
    ),
  );
});

test("decision state limits bound actual complete UTF8 wire and reported usage through loopback HTTP", async () => {
  const book = await fixture();
  const local = await loopbackFixture();

  const wireBytes = (value: D.SystemOneRequest) =>
    new TextEncoder().encode(JSON.stringify(value)).length;

  const multibyte = { ...request, state: "å".repeat(100) };

  const envelope = {
    ...request,
    state: "x",
    questions: { kind: { ...request.questions.kind!, instructions: "x".repeat(300) } },
  };

  const expanded = { ...request, state: "199001011234" };
  const limit = wireBytes(request);

  const cases = [
    { name: "exact", input: request, limit, expected: "validated", calls: 1 },
    { name: "one_byte_over", input: request, limit: limit - 1, expected: "state_limit", calls: 0 },
    {
      name: "multibyte",
      input: multibyte,
      limit: JSON.stringify(multibyte).length,
      expected: "state_limit",
      calls: 0,
    },
    {
      name: "envelope",
      input: envelope,
      limit: wireBytes(request),
      expected: "state_limit",
      calls: 0,
    },
    {
      name: "tokenised_growth",
      input: expanded,
      limit: wireBytes(expanded) + 1,
      expected: "state_limit",
      calls: 0,
    },
    {
      name: "usage_equal",
      input: request,
      limit,
      endpoint: `usage_${limit}`,
      expected: "state_limit",
      calls: 1,
    },
    {
      name: "usage_above",
      input: request,
      limit,
      endpoint: `usage_${limit + 1}`,
      expected: "state_limit",
      calls: 1,
    },
    {
      name: "usage_below",
      input: request,
      limit,
      endpoint: `usage_${limit - 1}`,
      expected: "validated",
      calls: 1,
    },
  ];

  const observed = [];

  try {
    for (const item of cases) {
      const endpoint = item.endpoint ?? item.name;

      const model = required(
        configuredDecisionModel({
          OPENERP_DECISION_MODEL: "local-systemone-fixture",
          OPENERP_DECISION_MODEL_RELEASE: release,
          OPENERP_DECISION_MODEL_ENDPOINT: `${local.origin}/${endpoint}`,
          OPENERP_DECISION_MODEL_INPUT_TOKEN_LIMIT: String(item.limit),
        }),
      );

      const result = await withAiEgress(book, (egress) => model.decide(item.input, egress));
      observed.push({
        name: item.name,
        expected: item.expected,
        observed: result.status === "validated" ? "validated" : result.code,
        expectedCalls: item.calls,
        calls: local.counts[endpoint] ?? 0,
        inputBytes: wireBytes(item.input),
        limit: item.limit,
        identity: model.identity,
      });
    }

    const postTokenisationBytes = await withAiEgress(book, async (egress) => {
      const model = required(
        configuredDecisionModel({
          OPENERP_DECISION_MODEL: "local-systemone-fixture",
          OPENERP_DECISION_MODEL_RELEASE: release,
          OPENERP_DECISION_MODEL_ENDPOINT: `${local.origin}/never`,
        }),
      );

      const output = await egress.structured(
        model.identity.egressPolicy,
        Schema.decodeUnknownSync(Schema.Json)(expanded),
        ["free_text"],
      );

      return new TextEncoder().encode(JSON.stringify(output.payload)).length;
    });

    await writeFile(
      join(environment().artifacts, "decision-state-limits-http.json"),
      JSON.stringify(
        { syntheticOnly: true, observed, postTokenisationBytes, counts: local.counts },
        null,
        2,
      ),
    );

    for (const item of observed) {
      expect(item.observed, item.name).toBe(item.expected);
      expect(item.calls, item.name).toBe(item.expectedCalls);
      expect(item.identity).toMatchObject({
        inputTokenLimit: item.limit,
        releaseQualification: "unsubstantiated",
      });
    }

    expect(postTokenisationBytes).toBeGreaterThan(wireBytes(expanded) + 1);
  } finally {
    await local.close();
  }
});

test("decision state limits pin hosted selectors and refuse absent or invalid manual release limits", async () => {
  const book = await fixture();
  const calls: Array<{ selector: string; bytes: number }> = [];

  const binding: WorkersAi = {
    async run(selector, input) {
      calls.push({ selector, bytes: new TextEncoder().encode(JSON.stringify(input)).length });

      return authoredResponse(input.model);
    },
  };

  const base = {
    OPENERP_DECISION_MODEL_RELEASE: release,
    OPENERP_AI_EGRESS_POLICY: "self-hosted",
    OPENERP_AI_EGRESS_APPROVAL: "synthetic-only",
  };

  const observed = [];

  for (const [selector, limit] of [
    ["clef", 64000],
    ["clef-flash", 24576],
  ] as const) {
    const model = required(
      configuredDecisionModel(
        {
          ...base,
          OPENERP_DECISION_MODEL: "workers-ai-clef",
          OPENERP_DECISION_MODEL_SELECTOR: selector,
        },
        binding,
      ),
    );

    const before = calls.length;

    const result = await withAiEgress(book, (egress) =>
      model.decide({ ...request, model: selector, state: "x".repeat(limit) }, egress),
    );

    observed.push({
      selector,
      limit,
      identity: model.identity,
      result,
      dispatches: calls.length - before,
    });
  }

  const invalid = [];

  for (const mode of ["self-hosted-clef", "typesafe-jev"]) {
    for (const limit of [undefined, "", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
      let refused = false;

      try {
        configuredDecisionModel({
          ...base,
          OPENERP_DECISION_MODEL: mode,
          OPENERP_DECISION_MODEL_ENDPOINT: "https://synthetic.invalid/decision",
          OPENERP_DECISION_MODEL_KEY: credential,
          OPENERP_DECISION_MODEL_INPUT_TOKEN_LIMIT: limit,
        });
      } catch {
        refused = true;
      }

      invalid.push({ mode, limit: limit ?? "missing", refused });
    }
  }

  await writeFile(
    join(environment().artifacts, "decision-state-limits-config.json"),
    JSON.stringify({ syntheticBindingOnly: true, observed, invalid, calls }, null, 2),
  );

  for (const item of observed) {
    expect(item.result).toMatchObject({ status: "failed", code: "state_limit" });
    expect(item.dispatches).toBe(0);
    expect(item.identity).toMatchObject({ inputTokenLimit: item.limit });
  }

  expect(invalid.every((item) => item.refused)).toBe(true);
  expect(
    configuredDecisionModel(
      { OPENERP_DECISION_MODEL: "disabled", OPENERP_DECISION_MODEL_INPUT_TOKEN_LIMIT: "NaN" },
      binding,
    ),
  ).toBeUndefined();
  expect(() =>
    configuredDecisionModel(
      {
        ...base,
        OPENERP_DECISION_MODEL: "workers-ai-clef",
        OPENERP_DECISION_MODEL_INPUT_TOKEN_LIMIT: "64000",
      },
      binding,
    ),
  ).toThrow();

  const fixtureModel = required(
    configuredDecisionModel({
      OPENERP_DECISION_MODEL: "local-systemone-fixture",
      OPENERP_DECISION_MODEL_RELEASE: release,
      OPENERP_DECISION_MODEL_ENDPOINT: "http://127.0.0.1/decision",
    }),
  );

  expect(fixtureModel.identity).toMatchObject({ inputTokenLimit: 24576 });
  expect(() =>
    systemOneModel(
      { ...fixtureModel.identity, inputTokenLimit: NaN },
      { kind: "http", endpoint: new URL("http://127.0.0.1/decision") },
      1000,
    ),
  ).toThrow();
});

test("configured decision deadlines retain a fifteen-second lease margin", async () => {
  const book = await fixture();
  const local = await loopbackFixture();
  let bindingCalls = 0;

  const binding: WorkersAi = {
    async run() {
      bindingCalls++;

      return authoredResponse("clef-flash");
    },
  };

  const observations = [];

  try {
    for (const mode of ["local-systemone-fixture", "workers-ai-clef"] as const) {
      for (const timeoutMs of [45001, 60000]) {
        let refused = false;

        try {
          configuredDecisionModel(
            {
              OPENERP_DECISION_MODEL: mode,
              OPENERP_DECISION_MODEL_RELEASE: release,
              OPENERP_DECISION_MODEL_ENDPOINT: `${local.origin}/invalid_deadline`,
              OPENERP_DECISION_MODEL_TIMEOUT_MS: String(timeoutMs),
            },
            binding,
          );
        } catch {
          refused = true;
        }

        observations.push({ mode, timeoutMs, refused });
      }
    }

    const rejectedTransportCalls = local.counts.invalid_deadline ?? 0;
    const rejectedBindingCalls = bindingCalls;

    const model = required(
      configuredDecisionModel({
        OPENERP_DECISION_MODEL: "local-systemone-fixture",
        OPENERP_DECISION_MODEL_RELEASE: release,
        OPENERP_DECISION_MODEL_ENDPOINT: `${local.origin}/valid_margin`,
        OPENERP_DECISION_MODEL_TIMEOUT_MS: "45000",
      }),
    );

    const accepted = await withAiEgress(book, (egress) => model.decide(request, egress));
    await writeFile(
      join(environment().artifacts, "decision-timeout-margin.json"),
      JSON.stringify(
        {
          syntheticOnly: true,
          deadlineMaximumMs: 45000,
          currentLeaseMs: 60000,
          blockedDatabaseGuarantee: false,
          observations,
          rejectedTransportCalls,
          rejectedBindingCalls,
          acceptedStatus: accepted.status,
          acceptedTransportCalls: local.counts.valid_margin ?? 0,
        },
        null,
        2,
      ),
    );
    expect(observations).toHaveLength(4);
    expect(observations.every((item) => item.refused)).toBe(true);
    expect(rejectedTransportCalls).toBe(0);
    expect(rejectedBindingCalls).toBe(0);
    expect(accepted.status).toBe("validated");
    expect(local.counts.valid_margin).toBe(1);
  } finally {
    await local.close();
  }
});
