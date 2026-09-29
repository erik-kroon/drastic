import { readFile } from 'node:fs/promises';
import { replayModel } from './supplier.mjs';
export async function readTrace(path) {
    const bytes = await readFile(path);
    if (bytes.length > 256000)
        throw Error('TraceTooLarge');
    const raw = JSON.parse(bytes.toString('utf8')), trace = raw.trace ?? raw;
    if (trace.schema !== 'assurance-supplier-history/v1' || !Number.isSafeInteger(trace.seed) || !trace.specification || !Array.isArray(trace.events) || trace.events.length < 2 || trace.events.length > 50)
        throw Error('UnsupportedTrace');
    if (trace.events[0]?.kind !== 'recognize')
        throw Error('MissingRecognition');
    for (const e of trace.events) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(e.id) || !['recognize', 'pay', 'credit', 'refund'].includes(e.kind))
            throw Error('InvalidEvent');
        const value = e.kind === 'credit' ? e.netMinor : e.kind === 'pay' || e.kind === 'refund' ? e.amountMinor : null;
        if (value !== null && (!/^[1-9][0-9]{0,37}$/.test(value)))
            throw Error('InvalidAmount');
    }
    replayModel(trace);
    return trace;
}
