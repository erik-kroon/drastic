#!/usr/bin/env node
/** Diagnostic only: each candidate gets a new harness/cluster/book. Original failure never becomes green. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readTrace } from '../models/trace.mjs';
import { shrinkCandidates } from '../models/supplier.mjs';
import { childEnvironment, runBounded, captureSources } from '../../scripts/runtime.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const filename = process.argv[2];
if (!filename || process.argv.length !== 3)
    throw Error('Usage: node verification/assurance/excellence/scripts/shrink.mjs failure-trace.json');
const original = await readTrace(resolve(filename)), out = join(root, 'test-results/excellence-shrink', randomUUID());
await mkdir(out, { recursive: true, mode: 0o700 });
const source = await captureSources(root);
let best = original;
const attempts = [];
// Fixed bound is deliberate. Shrinking can be expensive because each replay uses a real fresh DB.
for (const candidate of [original, ...shrinkCandidates(original).slice(0, 5)]) {
    const index = attempts.length, input = join(out, `candidate-${index}.json`), artifacts = join(out, `native-${index}`), json = join(out, `vitest-${index}.json`);
    await writeFile(input, JSON.stringify(candidate, null, 2));
    const result = await runBounded('bun', ['run', 'test:e2e', '--config', 'verification/assurance/excellence/diagnostic.config.ts'], { cwd: root, env: childEnvironment({ EXCELLENCE_TRACE_FILE: input, OPENERP_E2E_ARTIFACTS: artifacts, EXCELLENCE_JSON_REPORT: json, ...(process.env.PG_BINDIR ? { PG_BINDIR: process.env.PG_BINDIR } : {}) }), timeoutMs: 360000, logPath: join(out, `attempt-${index}.log`) });
    let diagnostic;
    try {
        diagnostic = JSON.parse(await readFile(join(artifacts, 'excellence-diagnostic.json'), 'utf8'));
    }
    catch {
        diagnostic = null;
    }
    const genuine = result.exitCode !== 0 && !result.timedOut && !result.signal && diagnostic?.kind === 'financial_mismatch';
    attempts.push({ index, events: candidate.events.length, exitCode: result.exitCode, status: genuine ? 'financial_failure_reproduced' : diagnostic?.outcome === 'passed' ? 'not_reproduced' : 'inconclusive', diagnostic });
    if (index === 0 && !genuine)
        break;
    if (genuine && candidate.events.length < best.events.length)
        best = candidate;
}
const after = await captureSources(root), valid = source.digest === after.digest;
await writeFile(join(out, 'best-trace.json'), JSON.stringify(best, null, 2));
await writeFile(join(out, 'shrink.json'), JSON.stringify({ schema: 'excellence-shrink/v1', status: valid && attempts[0]?.status === 'financial_failure_reproduced' ? 'diagnostic_complete' : 'inconclusive', originalFailurePreserved: true, sourceDigest: source.digest, sourceStable: valid, originalEventCount: original.events.length, bestEventCount: best.events.length, attempts, limitations: ['Bounded reduction, not globally minimal', 'No failed run is converted to a passing qualification', 'Only observed financial-state mismatches qualify as reproduction'] }, null, 2));
console.log(out);
process.exitCode = valid && attempts[0]?.status === 'financial_failure_reproduced' ? 0 : 2;
