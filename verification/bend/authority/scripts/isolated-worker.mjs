import { parentPort, workerData } from "node:worker_threads";
import { loadTestEngine } from "../tests/test-engine.mjs";
import { runOperation } from "../src/operations.mjs";

try {
  const engine = await loadTestEngine();
  parentPort.postMessage({
    ok: true,
    value: runOperation(engine, workerData.operation, workerData.input),
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: { code: error.code ?? "KernelUnavailable", message: String(error.message) },
  });
}
