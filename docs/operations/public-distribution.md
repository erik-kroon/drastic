# Public distribution qualification

Drastic owns public product development. The private openERP archive and private
company documents retain their custody boundary in
[ADR 0018](../adr/0018-public-product-repository.md).

## Branding

The repository package name, README, application titles, sign-in screens and
generated legal-document creator identify Drastic. The PDF font registry and
fixed theme both use the `Drastic Plex` family. The bundled font bytes and
upstream license notices remain intact.

Internal `@open-erp/*` packages, `OPENERP_*` configuration and retained renderer
identifiers remain stable. Existing records, historical citations and migration
checksums keep their original identities.

Repeat the source and real PDF checks from the repository root:

```sh
bun install --frozen-lockfile
bun run check:changed
bun run check:changed:full
bun run check:owners
bun run build
OPENERP_E2E_ARTIFACTS=test-results/issue-closeout-branding bun run test:e2e apps/api/tests/pdfcn.e2e.test.ts apps/api/tests/credit-document.e2e.test.ts
```

The 2026-10-09 isolated checkout passed frozen installation, changed-source,
type-aware, ownership and API/web build checks. All five selected PDF/credit
HTTP and PostgreSQL cases passed. The run retained a stable source inventory,
actual PDFs, independently extracted text, exact amounts, pagination and
recovery receipts under `test-results/issue-closeout-branding`.

These checks qualify synthetic engineering behavior. They do not establish
live customer delivery, statutory document acceptance or production deployment.

## Privacy and provenance

Branding qualification does not replace distribution review. Review the candidate
tree and all retained local history with redacted Gitleaks output. Classify
findings without publishing matched values. Preserve private recovery archives,
source checksums and uncommitted work separately. A filtered public history does
not prove that historical private originals were safe to publish.
