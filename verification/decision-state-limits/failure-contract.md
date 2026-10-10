# Failure-first expectations

- Clef pins 64000 input tokens and Clef-flash 24576; hosted configuration cannot raise either. Fixture defaults to authored 24576; self-host/Jev require an explicit positive safe integer. Disabled ignores otherwise invalid limit configuration.
- Identity retains its inputTokenLimit as a technical release constraint, not billing/quota or immutable-weight qualification. Direct adapter construction rejects missing/invalid limits too.
- A conservative byte gate bounds the complete JSON.stringify UTF-8 request envelope, including model, questions, options and actual state. Raw and post-AUT28 outgoing envelopes must each fit; no character-count approximation, truncation, retry or fallback. Exact byte boundary fits; one byte above refuses with zero transport calls.
- Swedish multibyte state, criteria overhead and tokenisation expansion independently refuse before dispatch. AUT28 remains active.
- A valid distribution whose reported input_tokens equals or exceeds the pinned limit refuses state_limit; below the limit remains an unreviewed claim. Unknown usage cannot fabricate a count.
- Actual loopback HTTP and authored injected binding fixtures are distinct evidence; neither qualifies live hosted weights or calls a provider.
