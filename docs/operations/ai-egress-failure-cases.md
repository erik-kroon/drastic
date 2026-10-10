# AI egress failure contract

These cases precede AUT-28 implementation. Use isolated synthetic books and local providers.

| Failure | Required observation |
| --- | --- |
| Client, owner, employee or private counterparty appears in nested text, keys or instructions | Provider receives typed tokens. Exact amounts, accounts, VAT and dates remain unchanged. |
| Counterparty has no classification | Mask its identity. Only an evidence-backed company classification preserves its name. |
| Client identity also names a supplier | Client masking takes precedence. |
| Same identity appears after restart, concurrently or after renaming | Stable book token, including historical aliases. Different books have different tokens. |
| Equal names refer to different people | Refuse ambiguous free text instead of guessing a person. |
| Personal or coordination number appears in free text | Replace it. Preserve a company organization number whose date component is invalid. |
| Caller supplies a reserved token | Refuse before disclosure. |
| Provider invents, malforms or imports a token | Refuse the output. |
| Provider returns a known token in narrative text | Keep the token. Restoration requires an explicit typed identity slot. |
| Typed slot names another identity kind or scope | Refuse restoration. |
| Audit storage fails, authority expires or membership is revoked | Make no provider call. |
| Provider times out or receipt is lost | Retain attempted-disclosure evidence without claiming confirmed receipt. Never resend a claimed raw original. |
| Raw reader enabled without approved data policy | Refuse before encoding or sending bytes. Polling also requires the boundary. |
| Injected adapter called without boundary context | Refuse. No unrestricted overload remains. |
| Diagnostics and audit are inspected | No prompts, aliases, personal numbers, original bytes, credentials or provider errors. |

Decisive proof uses the configured SystemOne HTTP and binding adapters, stored identity records and a fresh migrated PostgreSQL runtime. Existing document-reader journeys verify the real extraction owner and its no-resubmit fence. Each run retains a source manifest and synthetic JSON observations.
