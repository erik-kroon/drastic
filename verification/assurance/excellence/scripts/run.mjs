#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, stat, copyFile, open, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { captureSources, childEnvironment, runBounded, findTests, sha256, tool } from '../../scripts/runtime.mjs';
import { evaluateVitest, evaluateNodeTap } from '../../scripts/gates.mjs';
import { evaluateProfile } from './release-gate.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const profileName = process.argv[2] ?? 'core';
if (!['core', 'stress', 'kernel', 'company', 'release'].includes(profileName) || process.argv.length !== 3) {
    console.error('Usage: node verification/assurance/excellence/scripts/run.mjs core|stress|kernel|company|release');
    process.exit(2);
}
const runId = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
const out = join(root, 'test-results/excellence', runId);
await mkdir(out, { recursive: true, mode: 0o700 });
const record = { schema: 'openerp-excellence-run/v1', runId, profile: profileName, status: 'blocked', startedAt: new Date().toISOString(), stages: [], productionReady: false };
const reports = {}, evidence = {}, starts = {};
let before;
let lock;
const lockPath = join(root, "test-results/excellence/ACTIVE.lock");
const write = () => writeFile(join(out, 'run.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
const collect = async (path, name) => { const full = join(root, path), raw = await readFile(full), s = await stat(full); evidence[name] = { raw, sha256: sha256(raw), mtimeMs: s.mtimeMs, body: JSON.parse(raw.toString('utf8')) }; await writeFile(join(out, name), raw, { mode: 0o600 }); };
try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(JSON.stringify({ runId, pid: process.pid }));
    const profile = JSON.parse(await readFile(join(root, `verification/assurance/excellence/profiles/${profileName}.json`), 'utf8'));
    before = await captureSources(root);
    record.sourceBefore = before.digest;
    record.revision = tool('git', ['rev-parse', 'HEAD'], { cwd: root });
    await writeFile(join(out, 'source-before.json'), JSON.stringify(before, null, 2));
    // One invocation at a time: underlying assurance already has its own ACTIVE.lock.
    // This wrapper records all lane runs and does not edit sources or bless flaky reruns.
    const env = childEnvironment({ PATH: process.env.PATH ?? '', PG_BINDIR: process.env.PG_BINDIR ?? '' });
    for (const k of ['BEND_SOURCE_ROOT', 'OPENERP_OWNER_ADAPTER', 'BEND_BIN', 'BENDTT', 'BENDTT_SHA256', 'LEANC', 'TSC_BIN', 'EXCELLENCE_COMPANY_CASES', 'EXCELLENCE_COMPANY_OBSERVED'])
        if (process.env[k])
            env[k] = process.env[k];
    const selfTests = await findTests(root, 'verification/assurance/excellence/self-tests', '.test.mjs');
    const lanes = [{ id: 'tooling', cmd: process.execPath, args: ['--test', '--test-reporter=tap', ...selfTests], timeout: 60000 },
        { id: 'foundation', cmd: process.execPath, args: ['verification/assurance/scripts/run.mjs', 'full'], timeout: 2400000 },
        { id: 'recovery', cmd: 'bun', args: ['run', 'test:e2e', '--config', 'verification/assurance/excellence/recovery.config.ts'], timeout: 420000 }];
    if (profileName === 'stress' || profileName === 'release')
        lanes.push({ id: 'mutation', cmd: process.execPath, args: ['verification/assurance/scripts/mutate.mjs'], timeout: 900000 });
    if (profileName === 'kernel' || profileName === 'release')
        lanes.push({ id: 'official-bend', cmd: process.execPath, args: ['verification/assurance/scripts/run.mjs', 'bend-release'], timeout: 2100000 });
    if (profileName === 'company' || profileName === 'release')
        lanes.push({ id: 'company-qualification', cmd: process.execPath, args: ['verification/assurance/excellence/scripts/company-gate.mjs'], timeout: 30000 });
    for (const lane of lanes) {
        console.log('Excellence lane ' + lane.id);
        const laneEnv = { ...env, EXCELLENCE_PARENT_RUN: runId, OPENERP_E2E_ARTIFACTS: join('test-results', 'excellence-native', runId, lane.id), EXCELLENCE_JSON_REPORT: join(out, lane.id + '.json'), EXCELLENCE_JUNIT_REPORT: join(out, lane.id + '.xml') };
        const result = await runBounded(lane.cmd, lane.args, { cwd: root, env: laneEnv, timeoutMs: lane.timeout, logPath: join(out, lane.id + '.log') });
        starts[lane.id] = result.startedAt;
        const stage = { id: lane.id, ...result, status: 'blocked', logPath: lane.id + '.log' };
        record.stages.push(stage);
        if (result.timedOut || result.signal || result.spawnError || result.logOverflow)
            throw Error(lane.id + ' did not complete');
        if (lane.id === 'tooling') {
            stage.gate = evaluateNodeTap(await readFile(join(out, lane.id + '.log'), 'utf8'));
            stage.status = stage.gate.status;
        }
        else if (lane.id === 'foundation' || lane.id === 'official-bend') {
            // Discover ONLY the child identified by its inherited parent ID. See guarded runner patch.
            const childReceipt = join(root, 'test-results/excellence-child-links', `${runId}-${lane.id === 'foundation' ? 'full' : 'bend-release'}.json`);
            const link = JSON.parse(await readFile(childReceipt, 'utf8'));
            if (link.parentRun !== runId || !/^test-results\/assurance\/[a-zA-Z0-9T:.Z_-]+\/run\.json$/.test(link.relativeReport))
                throw Error('Invalid child link');
            const childPath = join(root, link.relativeReport), childRaw = await readFile(childPath), child = JSON.parse(childRaw.toString('utf8'));
            if (child.status !== 'passed' || child.startSourceDigest !== before.digest || child.endSourceDigest !== before.digest || Date.parse(child.startedAt) < result.startedAt - 2000)
                throw Error('Child did not qualify exact source');
            stage.child = link.relativeReport;
            stage.childSha256 = sha256(childRaw);
            stage.status = 'passed';
            await copyFile(childPath, join(out, lane.id + '-run.json'));
            if (lane.id === 'foundation') {
                const childDir = dirname(childPath);
                reports.pure = JSON.parse(await readFile(join(childDir, 'pure.json'), 'utf8'));
                reports.native = JSON.parse(await readFile(join(childDir, 'native.json'), 'utf8'));
                starts.pure = child.stages.find(s => s.id === 'pure')?.startedAt ?? result.startedAt;
                starts.native = child.stages.find(s => s.id === 'native')?.startedAt ?? result.startedAt;
                for (const name of ['pure.json', 'native.json'])
                    await copyFile(join(childDir, name), join(out, name));
                for (const c of profile.cases.filter(c => c.lane === 'native' && c.evidence))
                    await collect(join(laneEnv.OPENERP_E2E_ARTIFACTS, c.evidence), c.evidence);
            }
        }
        else if (lane.id === 'recovery') {
            reports.recovery = JSON.parse(await readFile(join(out, 'recovery.json'), 'utf8'));
            stage.gate = evaluateVitest(reports.recovery, { requiredFiles: ['apps/api/tests/assurance/excellence/recovery.recovery.test.ts'], notBefore: result.startedAt });
            stage.status = stage.gate.status;
            const integrity = JSON.parse(await readFile(join(root, laneEnv.OPENERP_E2E_ARTIFACTS, 'source-integrity.json'), 'utf8'));
            if (integrity.status !== 'stable')
                throw Error('Recovery source changed');
            await collect(join(laneEnv.OPENERP_E2E_ARTIFACTS, 'excellence-recovery.json'), 'excellence-recovery.json');
        }
        else if (lane.id === 'company-qualification') {
            const path = join(root, 'test-results/excellence-company', runId + '.json');
            const raw = await readFile(path), qualification = JSON.parse(raw);
            if (qualification.status !== 'passed' || qualification.sourceDigest !== before.digest)
                throw Error('Company case-set not qualified');
            await writeFile(join(out, 'company-qualification.json'), raw);
            stage.evidenceSHA256 = sha256(raw);
            stage.status = 'passed';
        }
        else
            stage.status = result.exitCode === 0 ? 'passed' : 'failed';
        if (result.exitCode !== 0)
            stage.status = 'failed';
        await write();
        if (stage.status !== 'passed')
            throw Error('Lane failed: ' + lane.id);
    }
    const after = await captureSources(root);
    record.sourceAfter = after.digest;
    await writeFile(join(out, 'source-after.json'), JSON.stringify(after, null, 2));
    const verdict = evaluateProfile(profile, { sourceBefore: before.digest, sourceAfter: after.digest, stages: record.stages, reports, evidence, startedAt: starts });
    record.verdict = verdict;
    record.status = verdict.status;
    await writeFile(join(out, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');
}
catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    record.status = record.stages.some(s => s.status === 'failed') ? 'failed' : 'blocked';
}
finally {
    record.finishedAt = new Date().toISOString();
    await write();
    if (lock) {
        await lock.close();
        const held = JSON.parse(await readFile(lockPath, 'utf8'));
        if (held.runId === runId)
            await rm(lockPath);
    }
}
console.log(`Excellence ${profileName}: ${record.status}. ${out}`);
process.exitCode = record.status === 'passed' ? 0 : record.status === 'failed' ? 1 : 2;
