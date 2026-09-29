import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCompany } from '../scripts/company-gate.mjs';
function fixture() { return { contract: { schema: 'openerp-independent-case-set/v1', scopeId: 'synthetic-example', fixtureDigest: 'retained-challenge-hash', review: { decisionRef: 'independent-review-1' }, cases: [{ id: 'purchase-example', inputDigest: 'input-hash', expected: { journal: [{ account: 'expense', debit: '100', credit: '0' }, { account: 'payable', debit: '0', credit: '100' }], payable: '100' } }] }, observed: { schema: 'openerp-observed-case-set/v1', scopeId: 'synthetic-example', fixtureDigest: 'retained-challenge-hash', applicationSourceDigest: 'source-hash', cases: [{ id: 'purchase-example', inputDigest: 'input-hash', status: 'passed', actualTrace: [{ operation: 'accept_purchase', requestId: 'request-1', outcome: 'committed', evidenceRef: 'retained-response-1', responseDigest: 'response-hash' }], observed: { journal: [{ account: 'expense', debit: '100', credit: '0' }, { account: 'payable', debit: '0', credit: '100' }], payable: '100' } }] } }; }
test('independent exact case membership and full result can qualify scoped comparison', () => { const f = fixture(); assert.equal(compareCompany(f.contract, f.observed, 'source-hash').status, 'passed'); });
test('company gate refuses empty expected set, unknown scope and missing reviewed decision', () => { for (const change of [f => f.contract.cases = [], f => delete f.contract.scopeId, f => f.contract.review = {}]) {
    const f = fixture();
    change(f);
    assert.equal(compareCompany(f.contract, f.observed, 'source-hash').status, 'blocked');
} });
test('company gate rejects six-books unsupported outcomes and empty execution trace', () => { for (const change of [f => f.observed.cases[0].status = 'BLOCKED_UNSUPPORTED', f => f.observed.cases[0].actualTrace = []]) {
    const f = fixture();
    change(f);
    assert.equal(compareCompany(f.contract, f.observed, 'source-hash').status, 'blocked');
} });
test('an extra offsetting journal pair cannot hide behind unchanged payable totals', () => { const f = fixture(); f.observed.cases[0].observed.journal.push({ account: 'expense', debit: '5', credit: '0' }, { account: 'expense', debit: '0', credit: '5' }); assert.equal(compareCompany(f.contract, f.observed, 'source-hash').status, 'blocked'); });
test('a missing, extra or duplicated case cannot pass', () => { for (const change of [f => f.observed.cases = [], f => f.observed.cases.push({ ...f.observed.cases[0] }), f => f.observed.cases.push({ ...f.observed.cases[0], id: 'extra' })]) {
    const f = fixture();
    change(f);
    assert.equal(compareCompany(f.contract, f.observed, 'source-hash').status, 'blocked');
} });
test('wrong source/input identities and unreferenced response trace remain blocked', () => { for (const change of [f => f.observed.applicationSourceDigest = 'other', f => f.observed.cases[0].inputDigest = 'other', f => delete f.observed.cases[0].actualTrace[0].responseDigest]) {
    const f = fixture();
    change(f);
    assert.equal(compareCompany(f.contract, f.observed, 'source-hash').status, 'blocked');
} });
