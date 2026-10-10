import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import * as Result from "effect/Result";
import * as D from "@open-erp/domain/decisions";
import * as C from "@open-erp/contracts/decisions";
import { database, decoded, environment, failure, fixture, request } from "./support/fixtures";

const model = "synthetic_decision_release_v1";

const choice = {
  type: "choice",
  instructions: "Synthetic closed choice",
  criteria: { selected: "Selected synthetic option", unknown: "Insufficient evidence" },
} as const;

function input(question: unknown = choice) {
  return { model, state: "Synthetic untrusted document text", questions: { question } };
}

function response(answer: unknown) {
  return { model, answers: { question: answer }, usage: { input_tokens: 1, output_tokens: 1 } };
}

function canonicalDigest(release: unknown) {
  const canonical = D.parseQuestionContent(release);

  if (Result.isFailure(canonical)) throw canonical.failure;

  return `sha256:${createHash("sha256").update(canonical.success.bytes).digest("hex")}`;
}

test("admitted book catalog exposes stable server-authored shadow questions without business writes", async () => {
  const book = await fixture();
  const foreign = await fixture();
  const path = "/automation/decision-questions";
  const catalog = await decoded(await request(book, path), C.DecisionQuestionCatalog);

  const replay = await decoded(
    await request(book, `${path}?criteria=pay_this_account`),
    C.DecisionQuestionCatalog,
  );

  expect(replay).toEqual(catalog);
  expect(catalog.scope.bookId).toBe(book.bookId);
  expect(catalog.limits).toEqual({
    maxQuestions: 64,
    maxChoiceOptions: 255,
    minScoreLevels: 2,
    maxScoreLevels: 10,
    probabilityTolerance: 0.000001,
    consistencyTolerance: 0.000000000001,
  });
  expect(catalog.releases).toHaveLength(2);
  expect(catalog.releases[1]?.version).toBe("document_kind_structured_v1");
  expect(catalog.releases[1]?.stateBuilder.version).toBe("supplier_structured_financial_facts_v1");
  const release = catalog.releases[0]!;

  expect(release.id).toBe("document_kind");
  expect(release.mode).toBe("shadow");
  expect(release.dataUse).toBe("synthetic_only");
  expect(release.question.type).toBe("choice");
  expect(release.question.instructions).toContain("untrusted evidence");
  expect(release.question.instructions).toContain("not authority");

  if (release.question.type !== "choice") throw new Error("Catalog taxonomy is not a choice");

  expect(Object.keys(release.question.criteria).sort()).toEqual([
    "bank_statement",
    "credit_note",
    "invoice",
    "other_tax_document",
    "payment_confirmation",
    "payment_reminder",
    "receipt",
    "supporting_document",
    "tax_account_statement",
    "unknown",
  ]);
  const { digest, optionSetDigest, ...content } = release;

  expect(digest).toBe(canonicalDigest(content));
  expect(optionSetDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  await failure(await request({ ...book, token: foreign.token }, path), 403, "Forbidden");
  await failure(await request({ ...book, token: "" }, path), 401, "Unauthorized");
  expect(
    (
      await request(book, path, {
        method: "POST",
        body: JSON.stringify({ criteria: "caller policy" }),
      })
    ).status,
  ).not.toBe(200);
  const admin = await database();

  try {
    const count = await admin.query(
      "SELECT count(*)::integer AS count FROM openerp.vouchers WHERE book_id=$1",
      [book.bookId],
    );

    expect(count.rows[0]!.count).toBe(0);
  } finally {
    await admin.end();
  }

  await writeFile(
    join(environment().artifacts, "decision-question-catalog.json"),
    JSON.stringify(
      { syntheticOnly: true, catalog, admittedBookId: book.bookId, businessVoucherCount: 0 },
      null,
      2,
    ),
  );
});

test("independent protocol vectors preserve full distributions and refuse malformed closed answers", async () => {
  const vectors = [
    {
      kind: "choice",
      probabilities: [1, 0],
      expectedConfidence: 1,
      expectedTop: 1,
      expectedMargin: 1,
      expectedScore: null,
    },
    {
      kind: "choice",
      probabilities: [0.5, 0.5],
      expectedConfidence: 0,
      expectedTop: 0.5,
      expectedMargin: 0,
      expectedScore: null,
    },
    {
      kind: "choice",
      probabilities: [0.6, 0.3, 0.1],
      expectedConfidence: 0.4,
      expectedTop: 0.6,
      expectedMargin: 0.3,
      expectedScore: null,
    },
    {
      kind: "choice",
      probabilities: [0.6, 0.2, 0.2],
      expectedConfidence: 0.4,
      expectedTop: 0.6,
      expectedMargin: 0.4,
      expectedScore: null,
    },
    {
      kind: "noul",
      probabilities: [0.5, 0.5],
      expectedConfidence: 0,
      expectedTop: 0.5,
      expectedMargin: 0,
      expectedScore: null,
    },
    {
      kind: "noul",
      probabilities: [0.9, 0.1],
      expectedConfidence: 0.8,
      expectedTop: 0.9,
      expectedMargin: 0.8,
      expectedScore: null,
    },
    {
      kind: "score",
      probabilities: [0, 0.5, 0.5],
      expectedConfidence: 0.25,
      expectedTop: 0.5,
      expectedMargin: 0,
      expectedScore: 1.5,
    },
    {
      kind: "score",
      probabilities: [0.5, 0, 0.5],
      expectedConfidence: 0,
      expectedTop: 0.5,
      expectedMargin: 0,
      expectedScore: 1,
    },
    {
      kind: "score",
      probabilities: [0.9, 0.1],
      expectedConfidence: 0.8,
      expectedTop: 0.9,
      expectedMargin: 0.8,
      expectedScore: 0.1,
    },
  ] as const;

  const observed = [];

  for (const vector of vectors) {
    const keys = vector.probabilities.map((_, index) =>
      index === vector.probabilities.length - 1 && vector.kind === "choice"
        ? "unknown"
        : String(index),
    );

    const probabilities = Object.fromEntries(
      keys.map((key, index) => [key, vector.probabilities[index]]),
    );

    let question: unknown;
    let answer: unknown;

    if (vector.kind === "choice") {
      question = {
        ...choice,
        criteria: Object.fromEntries(keys.map((key) => [key, `Synthetic option ${key}`])),
      };
      answer = {
        type: "choice",
        choice: keys[0],
        probabilities,
        confidence: vector.expectedConfidence,
      };
    } else if (vector.kind === "noul") {
      question = { type: "noul", instructions: "Synthetic yes/no evidence" };
      answer = { type: "noul", noul: vector.probabilities[0] };
    } else {
      const criteria = keys.map((key) => `Synthetic level ${key}`);
      question = { type: "score", instructions: "Synthetic ordered rubric", criteria };
      answer = {
        type: "score",
        score: vector.expectedScore,
        probabilities,
        legend: Object.fromEntries(keys.map((key) => [key, criteria[Number(key)]])),
        confidence: vector.expectedConfidence,
      };
    }

    const admitted = D.parseRequest(input(question));
    expect(admitted.status).toBe("ready");

    if (admitted.status !== "ready") throw new Error("Authored valid request was refused");
    const validated = D.validateResponse(admitted.request, response(answer), model);

    expect(validated.status).toBe("validated");

    if (validated.status !== "validated") throw new Error("Authored valid answer was refused");
    const stats = validated.statistics.question!;

    expect(stats.confidence).toBeCloseTo(vector.expectedConfidence, 12);
    expect(stats.topProbability).toBeCloseTo(vector.expectedTop, 12);
    expect(stats.margin).toBeCloseTo(vector.expectedMargin, 12);

    if (vector.expectedScore !== null)
      expect(stats.weightedScore).toBeCloseTo(vector.expectedScore, 12);
    else expect(stats.weightedScore).toBeNull();
    observed.push({ expected: vector, observed: validated });
  }

  const valid = D.parseRequest(input());

  if (valid.status !== "ready") throw new Error("Base request was refused");

  const answer = {
    type: "choice",
    choice: "selected",
    probabilities: { selected: 0.9, unknown: 0.1 },
    confidence: 0.8,
  };

  const refusals = [
    { name: "missing question", raw: { ...response(answer), answers: {} } },
    {
      name: "extra question",
      raw: { ...response(answer), answers: { question: answer, extra: answer } },
    },
    { name: "missing option", raw: response({ ...answer, probabilities: { selected: 1 } }) },
    {
      name: "extra option",
      raw: response({ ...answer, probabilities: { selected: 0.9, unknown: 0.1, extra: 0 } }),
    },
    {
      name: "missing distribution",
      raw: response({ type: "choice", choice: "selected", confidence: 1 }),
    },
    {
      name: "negative probability",
      raw: response({ ...answer, probabilities: { selected: -0.1, unknown: 1.1 } }),
    },
    {
      name: "nonfinite probability",
      raw: response({ ...answer, probabilities: { selected: NaN, unknown: 0.1 } }),
    },
    {
      name: "infinite probability",
      raw: response({ ...answer, probabilities: { selected: Infinity, unknown: 0.1 } }),
    },
    {
      name: "invalid sum",
      raw: response({ ...answer, probabilities: { selected: 0.9, unknown: 0.2 } }),
    },
    { name: "outside choice", raw: response({ ...answer, choice: "foreign" }) },
    { name: "not argmax", raw: response({ ...answer, choice: "unknown" }) },
    { name: "kind mismatch", raw: response({ type: "noul", noul: 0.9 }) },
    { name: "model mismatch", raw: { ...response(answer), model: "synthetic_other_release" } },
    { name: "unknown response field", raw: { ...response(answer), authority: true } },
  ];

  const refusalResults = refusals.map((item) => ({
    name: item.name,
    expected: "refused",
    observed: D.validateResponse(valid.request, item.raw, model),
  }));

  expect(refusalResults.every((item) => item.observed.status === "refused")).toBe(true);
  expect(
    D.validateResponse(
      valid.request,
      response({ ...answer, choice: "unknown", probabilities: { selected: 0.5, unknown: 0.5 } }),
      model,
    ).status,
  ).toBe("validated");
  const toleratedDistribution = { selected: 0.49999975, unknown: 0.49999975 };

  const tolerated = D.validateResponse(
    valid.request,
    response({ ...answer, probabilities: toleratedDistribution, confidence: 0 }),
    model,
  );

  expect(tolerated.status).toBe("validated");

  if (tolerated.status !== "validated") throw new Error("Transport tolerance was refused");

  expect(tolerated.statistics.question!.confidence).toBe(0);
  expect(tolerated.response.answers.question).toMatchObject({
    probabilities: toleratedDistribution,
  });

  const limits = [];

  for (const count of [255, 256]) {
    const criteria = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        index === count - 1 ? "unknown" : `option_${index}`,
        "Synthetic candidate",
      ]),
    );

    const admission = D.parseRequest(input({ ...choice, criteria }));
    expect(admission.status).toBe(count === 255 ? "ready" : "skipped");

    if (admission.status === "ready")
      expect(
        Object.keys(
          admission.request.questions.question!.type === "choice"
            ? admission.request.questions.question!.criteria
            : {},
        ),
      ).toHaveLength(255);
    limits.push({ count, observed: admission.status });
  }

  for (const count of [64, 65]) {
    const admission = D.parseRequest({
      ...input(),
      questions: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`question_${index}`, choice]),
      ),
    });

    expect(admission.status).toBe(count === 64 ? "ready" : "skipped");
    limits.push({ count, observed: admission.status });
  }

  const badRequests = [
    input({ ...choice, criteria: {} }),
    input({ ...choice, criteria: { first: "No unknown", second: "Still no unknown" } }),
    input({ type: "score", instructions: "Invalid rubric", criteria: ["One level"] }),
    input({
      type: "score",
      instructions: "Invalid rubric",
      criteria: Array.from({ length: 11 }, () => "Level"),
    }),
  ];

  expect(badRequests.map(D.parseRequest).every((item) => item.status === "refused")).toBe(true);
  expect(
    D.parseRequest(input({ ...choice, criteria: { unknown: "Only trivial option" } })).status,
  ).toBe("skipped");
  expect(D.parseRequest({ ...input(), state: null }).status).toBe("skipped");

  const score = D.parseRequest(
    input({ type: "score", instructions: "Ordered rubric", criteria: ["Low", "High"] }),
  );

  if (score.status !== "ready") throw new Error("Valid score request refused");

  const scoreAnswer = {
    type: "score",
    score: 0.1,
    probabilities: { "0": 0.9, "1": 0.1 },
    legend: { "0": "Low", "1": "High" },
    confidence: 0.8,
  };

  const badScores = [
    { ...scoreAnswer, score: 2 },
    { ...scoreAnswer, score: 0.9 },
    { ...scoreAnswer, probabilities: { "0": 1 } },
    { ...scoreAnswer, legend: { "0": "Low", "1": "High", "2": "Extra" } },
    { ...scoreAnswer, legend: { "0": "Wrong", "1": "High" } },
  ];

  expect(
    badScores
      .map((raw) => D.validateResponse(score.request, response(raw), model))
      .every((item) => item.status === "refused"),
  ).toBe(true);

  const release = {
    id: "synthetic_question",
    version: "v1",
    mode: "shadow",
    dataUse: "synthetic_only",
    stateBuilder: { id: "retained_text", version: "v1" },
    optionBuilder: { id: "closed_options", version: "v1" },
    question: choice,
  };

  const reordered = {
    ...release,
    question: {
      ...choice,
      criteria: { unknown: choice.criteria.unknown, selected: choice.criteria.selected },
    },
  };

  expect(canonicalDigest(reordered)).toBe(canonicalDigest(release));
  expect(
    canonicalDigest({
      ...release,
      question: { ...choice, instructions: "Changed criteria policy" },
    }),
  ).not.toBe(canonicalDigest(release));
  expect(
    canonicalDigest({ ...release, stateBuilder: { ...release.stateBuilder, version: "v2" } }),
  ).not.toBe(canonicalDigest(release));
  await writeFile(
    join(environment().artifacts, "decision-protocol-vectors.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        observed,
        refusalResults,
        toleratedNearUniform: { expectedConfidence: 0, observed: tolerated },
        limits,
        invalidRequestCount: badRequests.length,
        invalidScoreCount: badScores.length,
        singleOption: "skipped",
        missingInput: "skipped",
      },
      null,
      2,
    ),
  );
});
