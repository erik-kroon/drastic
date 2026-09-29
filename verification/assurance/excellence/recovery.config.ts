import { resolve } from 'node:path';
import { defineConfig } from 'vite-plus';
export default defineConfig({ root: resolve(import.meta.dirname, '../../..'), test: {
        include: ['apps/api/tests/assurance/excellence/*.recovery.test.ts'],
        globalSetup: ['./apps/api/tests/support/global-setup.ts'], environment: 'node', fileParallelism: false, retry: 0, allowOnly: false, passWithNoTests: false, testTimeout: 300000, hookTimeout: 120000,
        reporters: ['default', 'json', 'junit'], outputFile: { json: process.env.EXCELLENCE_JSON_REPORT ?? 'test-results/excellence-recovery/results.json', junit: process.env.EXCELLENCE_JUNIT_REPORT ?? 'test-results/excellence-recovery/junit.xml' },
    } });
