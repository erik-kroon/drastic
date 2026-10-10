# Independent provider adapter failure cases (AUT-10)

Written before adapter implementation. All fixtures are authored synthetic loopback material. No fixture result authorizes accounting work. The current Bun runtime has no Workers AI binding; the Cloudflare port must be injected explicitly.

| Provider/configuration case | Required observation |
| --- | --- |
| Disabled mode with credentials/binding present | No provider construction or call |
| Explicit provider without required release | Configuration refusal |
| Local fixture on non-loopback host | Configuration refusal |
| Live HTTP without HTTPS or credential | Configuration refusal |
| Workers AI mode without injected binding | Configuration refusal |
| Valid full authored distribution | Same strict domain validation as both transports; full result retained |
| Header timeout | Typed timeout, no result |
| Body stalls after successful headers | Deadline still applies; typed timeout, no result |
| HTTP429 | Typed rate-limit diagnostic, no adapter-internal automatic retry |
| Oversized response | Bounded read refusal before unbounded buffering |
| Invalid UTF-8 or malformed JSON | Protocol refusal, no result |
| Duplicate response keys | Refused before JSON.parse on HTTP wire |
| Unexpected reported model identity | Diagnostic, never a validated result |
| Missing/unknown response option | Domain refusal, no result |
| Binding returns invalid or oversized object | Same validation/bounds refusal |
| Binding deadline expires | Stops waiting; no claim that remote inference was cancelled without support |
| Hosted selector exists but immutable weight revision is unsubstantiated | Retain the distinction; a local release flag is not qualification evidence |

HTTP byte/UTF-8/duplicate-key checks cover the raw wire. A Workers AI binding already returns an object, so it cannot prove absence of duplicate keys in the upstream wire representation. Request counts and terminal outcomes are retained in the artifact; credentials and full prompt material are omitted. Dispatch retries/idempotency and transaction fencing belong to AUT-11, not an adapter retry loop.

Primary references: [Cloudflare Clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/) and [TypeSafe API](https://docs.typesafe.ai/api). Source wiring is not a deployment or live-provider trial.
