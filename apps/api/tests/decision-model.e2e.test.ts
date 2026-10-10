import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import type * as D from "@open-erp/domain/decisions";
import { configuredDecisionModel } from "../src/runtime/decision-model";
import type {
  DecisionModel,
  DecisionOutcome,
  WorkersAi,
} from "../src/adapters/decision-models/systemone";
import { environment } from "./support/fixtures";

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

    if (name === "size") outgoing.end("x".repeat(1024 * 1024 + 1));
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

      const observed = await model.decide(request);

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

    const beforeAbort = await abortModel.decide(request, aborted.signal);

    expect(beforeAbort).toMatchObject({ status: "failed", code: "aborted" });
    expect(local.counts.abort).toBeUndefined();
    const during = new AbortController();
    const pending = abortModel.decide(request, during.signal);
    const abortTimer = setTimeout(() => during.abort(), 50);
    const duringAbort = await pending;
    clearTimeout(abortTimer);

    expect(duringAbort).toMatchObject({ status: "failed", code: "aborted" });
    expect(local.counts.abort).toBe(1);

    const invalidRequest = await required(configuredDecisionModel(base)).decide({
      ...request,
      model: "different_selector",
    });

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
    OPENERP_DECISION_MODEL_RELEASE: "synthetic_clef_configuration_1",
    OPENERP_DECISION_MODEL_TIMEOUT_MS: "100",
  };

  const model = required(configuredDecisionModel(config, binding));
  const input = { ...request, model: "clef-flash" };
  const success = await model.decide(input);

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
    const observed = await model.decide(input);

    expect(observed).toMatchObject({ status: "failed", code: item.expected });
    outcomes.push({ name: item.name, expected: item.expected, observed });
  }

  stalls = true;
  const timedOut = await model.decide(input);

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
