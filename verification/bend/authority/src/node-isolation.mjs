import { Worker } from "node:worker_threads";
import { KernelError, snapshot, integer } from "./contracts.mjs";

/** Experimental jobs only. The timeout terminates the worker, not just its promise.
 * Production deployments still need their own measured resource/runtime receipts.
 */
export function runIsolated(operation, input, { timeoutMs = 10000, memoryMb = 128, signal } = {}) {
  integer(timeoutMs, "timeoutMs", 1, 60000);
  integer(memoryMb, "memoryMb", 32, 1024);

  if (signal?.aborted)
    return Promise.reject(new KernelError("Cancelled", "Job cancelled before start"));

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../scripts/isolated-worker.mjs", import.meta.url), {
      workerData: snapshot({ operation, input }),
      resourceLimits: { maxOldGenerationSizeMb: memoryMb },
    });

    let settled = false;

    const finish = async (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      await worker.terminate();

      if (error) reject(error);
      else resolve(value);
    };

    const aborted = () => {
      void finish(new KernelError("Cancelled", "Job cancelled"));
    };

    const timer = setTimeout(() => {
      void finish(new KernelError("ResourceLimit", "Worker deadline exceeded"));
    }, timeoutMs);

    signal?.addEventListener("abort", aborted, { once: true });
    worker.once("message", (m) => {
      void finish(m.ok ? null : new KernelError(m.error.code, m.error.message), m.value);
    });
    worker.once("error", (error) => {
      void finish(new KernelError("KernelUnavailable", String(error.message)));
    });
    worker.once("exit", (code) => {
      if (!settled)
        void finish(
          new KernelError("KernelUnavailable", `Worker exited before a result (${code})`),
        );
    });
  });
}
