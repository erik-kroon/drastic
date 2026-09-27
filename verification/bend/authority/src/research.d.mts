import type { Operation, Inputs, Outputs } from "./index.mjs";
import type { Engine } from "../lib/index.mjs";

export function loadEngine(entry?: string): Promise<Engine>;
export function runOperation<K extends Operation>(
  engine: Engine,
  operation: K,
  input: Inputs[K],
): Outputs[K];
export function runIsolated<K extends Operation>(
  operation: K,
  input: Inputs[K],
  options?: { timeoutMs?: number; memoryMb?: number; signal?: AbortSignal },
): Promise<Outputs[K]>;

export { solveCover } from "../lib/index.mjs";
