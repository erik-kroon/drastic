# Secret scanning

Before publishing, scan all reachable history and a tracked-file snapshot with Gitleaks. The preparation used Gitleaks 8.30.1 and its default rules.

```bash
gitleaks git --log-opts="--all --full-history" --redact --report-format json --report-path /tmp/openerp-history-gitleaks.json .
git archive HEAD | tar -x -C /path/to/empty-review-directory
cd /path/to/empty-review-directory
gitleaks dir --redact --report-format json --report-path /tmp/openerp-tree-gitleaks.json .
```

Create the empty review directory yourself; keep reports outside the repository. Archive the committed source so dependency caches, local credentials and generated runtime output are excluded from the distribution scan.

The six initial filtered-history findings and three current-tree findings were inspected. All match deliberately synthetic profile identifiers named `fwd05_synthetic` or source identifiers named `fwd04_duplicate_owner` values in E2E fixtures. `.gitleaksignore` contains only those exact finding fingerprints, including historical commits. It does not exclude files, directories or secret rules. New locations remain subject to review.

A secret scan cannot establish that images, documents, company data or third-party material are safe to publish. Historical planning, company-source tooling and captured execution evidence are excluded from this distribution; retained fixtures and reference assets still need ordinary provenance review. Keep real books and credentials outside source, issues and test artifacts.
