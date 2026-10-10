### 🔴 e2e: 1 failed, 3 passed
2 agent steps · 3 model calls · 13.9k tokens

**🔴 stale quote commands refuse overwrite and lost responses recover the exact request after acceptance**  
`tests/browser/quote-revision.e2e.ts:611`

**ERROR**

> Enable PAPER_FIRM_RECOVERY=1 to qualify the independent signed-in human

- Screen: `/entities/entity_synthetic/books/book_synthetic/sales?view=orders`

Evidence: screenshot `test-results/testerarmy/13b73c90-3114-4904-9c70-23f8c9fb818e/artifacts/synthetic-chromium/tests_browser_quote-revision.e2e.ts__stale_20quote_20commands_20refuse_20overwrite_20and_20lost_20responses_20r-5b48e922/default/attempt-0/screenshot…`, screenshot `test-results/testerarmy/13b73c90-3114-4904-9c70-23f8c9fb818e/artifacts/synthetic-chromium/tests_browser_quote-revision.e2e.ts__stale_20quote_20commands_20refuse_20overwrite_20and_20lost_20responses_20r-5b48e922/default/attempt-0/screenshot…`, video `test-results/testerarmy/13b73c90-3114-4904-9c70-23f8c9fb818e/artifacts/synthetic-chromium/tests_browser_quote-revision.e2e.ts__stale_20quote_20commands_20refuse_20overwrite_20and_20lost_20responses_20r-5b48e922/default/attempt-0/video/vide…`, trace `test-results/testerarmy/13b73c90-3114-4904-9c70-23f8c9fb818e/artifacts/synthetic-chromium/tests_browser_quote-revision.e2e.ts__stale_20quote_20commands_20refuse_20overwrite_20and_20lost_20responses_20r-5b48e922/default/attempt-0/trace/trac…`, and 1 more · Details: `test-results/testerarmy/13b73c90-3114-4904-9c70-23f8c9fb818e/failures/tests_browser_quote-revision.e2e.ts-stale_quote_commands_refuse_overwrite_and_lost_responses_recover_the_exact_-c58fbdc7-22554557…`

<details>
<summary>All 4 tests in 2 files</summary>

|  | Test | Agent | Time |
| --- | --- | --- | --- |
| 🔴 | **tests/browser/quote-revision.e2e.ts** · 1 failed, 2 passed | 1 step · 2 calls | 38.0s |
| 🟢 | a reloaded quote deliberately reviews its own replacement and retains exact stored content | 1 step · 2 calls | 12.9s |
| 🟢 | late, failed and mismatched source reads cannot qualify another quote replacement |  | 14.5s |
| 🔴 | stale quote commands refuse overwrite and lost responses recover the exact request after acceptance |  | 10.6s |
| 🟢 | **tests/browser/article-register.e2e.ts** · 1 passed | 1 step · 1 call | 18.3s |
| 🟢 | article edit and archive retain immutable defaults, honest unknowns and aligned register lanes | 1 step · 1 call | 18.3s |
</details>

<sub>e2e 0.17.0 · 57.1s · synthetic-chromium</sub>
