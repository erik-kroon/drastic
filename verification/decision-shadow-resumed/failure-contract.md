# AUT-11 resumed failure contract

These expectations precede the resumed implementation. Parked lifecycle failures are kept separately from queue delivery evidence. Only synthetic fixture transports are exercised.

- Real effect-mq delivery must use the current AUT-28 port; the obsolete signal-as-egress call refuses before transport.
- Raw evidence, line descriptions, client messages, private IDs, target chosen treatment, labels and whole precedents must be absent from the actual provider envelope. Source and precedent digests/IDs remain internal immutable evidence.
- Structured state and its question/state builder release are explicitly versioned. Missing supported input is a countable skip. Historical text-segment releases are not relabelled as structured releases.
- Policy exposes off/shadow and technical pinned input limits, with no dispatch budget, quota, reservation or billing feature. Ordinary runners default to disabled regardless of ambient credentials.
- The model's guarded pre-dispatch callback runs only after protocol, egress and complete-byte checks. The durable marker must commit before actual transport. Local refusal with no callback means not_disclosed; reported-usage refusal after transport remains disclosed/unknown if trustworthy usage is unavailable.
- A validated result retains protocol-reported usage in its result and terminal attempt as provider_reported; this is evidence, not independently verified billing. Timeout/uncertain usage stays unknown.
- A callback that loses its lease or current requester/subject/policy refuses transport. A marker committed but a process lost before transport remains uncertain and never redispatches.
- Concurrent admission/replay, lease fencing after blocked freshness locks, requester and exact runner credential revocation, policy/subject changes, result replay, malformed/model mismatch/timeout and 429 preserve the existing failure contract.
- Shadow does not serve suggestion records, alter product read models/ordinary queues/financial receipts or run a provider in posting. Paired financial projections retain exact amounts and receipt bindings; only generated IDs/time are normalized.
- Binding fixtures are authored source-port tests, never Cloudflare execution or weight/data-use qualification. No automatic retry after an uncertain dispatch.
