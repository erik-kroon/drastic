### 🟢 e2e: 4 passed
2 agent steps · 4 model calls · 20.5k tokens

<details>
<summary>All 4 tests in 2 files</summary>

|  | Test | Agent | Time |
| --- | --- | --- | --- |
| 🟢 | **tests/browser/article-register.e2e.ts** · 1 passed | 1 step · 1 call | 12.6s |
| 🟢 | article edit and archive retain immutable defaults, honest unknowns and aligned register lanes | 1 step · 1 call | 12.6s |
| 🟢 | **tests/browser/quote-revision.e2e.ts** · 3 passed | 1 step · 3 calls | 34.0s |
| 🟢 | a reloaded quote deliberately reviews its own replacement and retains exact stored content | 1 step · 3 calls | 14.4s |
| 🟢 | late, failed and mismatched source reads cannot qualify another quote replacement |  | 11.1s |
| 🟢 | stale quote commands refuse overwrite and lost responses recover the exact request after acceptance |  | 8.4s |
</details>

<sub>e2e 0.17.0 · 47.9s · synthetic-chromium</sub>
