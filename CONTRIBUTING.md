# Contributing to OpenERP

Start with [the documentation index](docs/README.md), [repository instructions](AGENTS.md) and [architecture](docs/architecture.md). The product is under development; supported synthetic behavior, production accounting and externally accepted filings are different claims.

## Local work

Use the pinned Bun version, run `bun install`, and follow [local development](README.md#local-development). The [self-host package](infra/self-host/README.md) runs the built application and accounting API without a Cloudflare account. Use isolated synthetic data for development.

Keep changes at their current owner. Reuse Effect Schema contracts and the shared business operation through REST, MCP and the UI. Preserve exact amounts, sealed-plan interpretation, restricted database privileges and atomic receipts. Forward migrations must retain already applied migration checksums. Run relevant formatting, lint, type, build and existing E2E checks; record actual results and limitations.

The current repository policy requires explicit approval before adding or changing tests or fixtures. Describe independently expected failure cases before the implementation that needs them. Do not weaken checks to get a passing result.

## Reviewable changes

Describe the user-visible outcome, affected capability and contract, migration impact, verification environment and remaining gaps. A useful change includes its consumer and documentation. Avoid empty packages, new frameworks or language boundaries without a demonstrated caller.

The accounting application, jurisdiction implementations, adapters and agent interface stay available under the project license. Optional managed operations must not become a mandatory license server, hosted credential or paid API for local accounting. Keep service credentials, customer books and private evaluation data out of commits and issues.

Contribute code you have the right to provide under [AGPL-3.0-only](LICENSING.md). Preserve existing third-party notices and identify the source and terms of adapted material. Do not copy reference implementations or datasets solely because they are publicly accessible.
