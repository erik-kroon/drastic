import { test } from "vitest";
import {
  createModel,
  advance,
} from "../../../../../verification/assurance/excellence/models/supplier.mjs";
import { readTrace } from "../../../../../verification/assurance/excellence/models/trace.mjs";
import { createPurchase, applyEvent, assertState, saveTrace } from "./supplier-driver";

// Diagnostic config only. Absence of a trace is an error, never a skipped green case.
test("[EXC-TRACE-REPLAY] execute retained history in a fresh application book", async () => {
  const path = process.env.EXCELLENCE_TRACE_FILE;

  if (!path) throw Error("EXCELLENCE_TRACE_FILE required");
  const trace = await readTrace(path);
  const w = await createPurchase(trace.specification);
  let state = advance(createModel(trace.specification), trace.events[0]!);
  let stage = "observe";
  let step = 0;

  try {
    await assertState(w, state);

    for (let i = 1; i < trace.events.length; i++) {
      step = i;
      const e = trace.events[i]!;

      if (e.kind === "recognize") throw Error("Unexpected recognition");
      stage = "operation";
      await applyEvent(w, e, state);
      state = advance(state, e);
      stage = "observe";
      await assertState(w, state);
    }

    await saveTrace("diagnostic", {
      schema: "excellence-diagnostic/v1",
      outcome: "passed",
      trace,
      observations: w.observations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    const kind =
      stage === "observe" &&
      (message === "JournalFootprintMismatch" ||
        (error instanceof Error && error.name === "AssertionError"))
        ? "financial_mismatch"
        : "operation_or_infrastructure_failure";

    await saveTrace("diagnostic", {
      schema: "excellence-diagnostic/v1",
      outcome: "failed",
      kind,
      step,
      trace,
      message,
      observations: w.observations,
    });
    throw error;
  }
}, 240000);
