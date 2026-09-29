import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, advance, position, balances, generateHistory, replayModel, shrinkCandidates, assertExactRows, ModelRefusal } from '../models/supplier.mjs';
test('independent full-deduction worked sequence has exact principal and tax states', () => {
    let s = createModel();
    s = advance(s, { kind: 'recognize', id: 'p' });
    s = advance(s, { kind: 'pay', id: 'cash', amountMinor: '100000' });
    s = advance(s, { kind: 'credit', id: 'cn', netMinor: '40000' });
    assert.deepEqual(position(s), { gross: '125000', credited: '50000', paid: '100000', refunded: '0', unpaid: '0', refundPrincipal: '25000', refundDue: '25000' });
    assert.deepEqual(balances(s), { account_bank: '-100000', account_expense: '60000', account_input_vat: '15000', account_payable: '0', account_refund_receivable: '25000' });
    s = advance(s, { kind: 'refund', id: 'r', amountMinor: '10000' });
    assert.equal(position(s).refundDue, '15000');
});
test('half-deduction final credit releases the exact last minor unit', () => {
    let s = createModel({ netMinor: '100', deductionDenominator: '2' });
    s = advance(s, { kind: 'recognize', id: 'p' });
    s = advance(s, { kind: 'pay', id: 'payment', amountMinor: '100' });
    s = advance(s, { kind: 'credit', id: 'c1', netMinor: '40' });
    assert.equal(s.releasedDeduction, 5n);
    s = advance(s, { kind: 'credit', id: 'c2', netMinor: '60' });
    assert.equal(s.releasedDeduction, 13n);
    assert.deepEqual(s.effects.at(-1).rows, [{ accountId: 'account_expense', signedMinor: '-67' }, { accountId: 'account_input_vat', signedMinor: '-8' }, { accountId: 'account_refund_receivable', signedMinor: '75' }]);
});
test('model refuses duplicate economic identity, overpayment, overcredit and overrefund', () => {
    const a = advance(createModel(), { kind: 'recognize', id: 'p' });
    for (const e of [{ kind: 'pay', id: 'p', amountMinor: '1' }, { kind: 'pay', id: 'x', amountMinor: '125001' }, { kind: 'credit', id: 'x', netMinor: '100004' }, { kind: 'refund', id: 'x', amountMinor: '1' }])
        assert.throws(() => advance(a, e), ModelRefusal);
});
test('256 deterministic generated traces conserve quantities and reach exact closure', () => {
    for (let seed = 1; seed <= 256; seed++)
        for (const d of ['1', '2']) {
            const a = generateHistory(seed, { deductionDenominator: d }), b = generateHistory(seed, { deductionDenominator: d });
            assert.deepEqual(a, b);
            let s = createModel(a.specification);
            for (const event of a.events) {
                s = advance(s, event);
                assert.equal(s.effects.at(-1).rows.reduce((v, x) => v + BigInt(x.signedMinor), 0n), 0n);
                const p = position(s);
                assert.ok(BigInt(p.unpaid) >= 0n && BigInt(p.refundDue) >= 0n);
            }
            assert.deepEqual(Object.values(balances(s)), ['0', '0', '0', '0', '0']);
            assert.equal(s.creditNet, s.N);
            assert.equal(s.refunded, s.paid);
        }
});
test('shrinker never proposes a financially invalid subsequence', () => {
    const t = generateHistory(12648430, { deductionDenominator: '2' }), candidates = shrinkCandidates(t);
    assert.ok(candidates.length > 0);
    for (const c of candidates) {
        assert.ok(c.events.length < t.events.length);
        assert.doesNotThrow(() => replayModel(c));
        assert.equal(c.events[0].kind, 'recognize');
    }
});
test('exact-footprint oracle detects extra balanced lines and wrong source-role distribution', () => {
    const expected = [{ accountId: 'expense', signedMinor: '100' }, { accountId: 'payable', signedMinor: '-100' }];
    assert.doesNotThrow(() => assertExactRows(expected, expected));
    assert.throws(() => assertExactRows([...expected, { accountId: 'expense', signedMinor: '5' }, { accountId: 'expense', signedMinor: '-5' }], expected), /JournalFootprintMismatch/);
    assert.throws(() => assertExactRows([{ accountId: 'bank', signedMinor: '100' }, { accountId: 'payable', signedMinor: '-100' }], expected), /JournalFootprintMismatch/);
});
