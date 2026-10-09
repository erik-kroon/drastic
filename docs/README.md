# Engineering documentation

Start with [local development](local-development.md) or [self-hosting](../infra/self-host/README.md) to run the application with synthetic data.

- [Architecture](architecture.md): application ownership, adapters and runtime boundaries.
- [Accounting invariants](domain.md): amounts, approval, posting, receipts and corrections.
- [API map](../apps/api/README.md): workflow owners and transport layout.
- [Authentication](../apps/api/docs/AUTH.md) and [MCP](../apps/api/docs/MCP.md): browser and agent access.
- [Application-owned accounting](adr/0010-application-owned-accounting-replacement.md), [exact approval](adr/0002-exact-posting-and-approval.md) and [background jobs](adr/0009-effect-mq-background-jobs.md): selected engineering decisions.
- [API E2E](../apps/api/tests/README.md) and [browser verification](../verification/testerarmy/README.md): execution recipes and saved artifacts.

Detailed delivery planning, company qualification, design exports and historical execution evidence remain in the private working archive. Historical decisions describe their dated scope, not production readiness or fresh verification. Public source contains the owner declaration and permission matrix consumed by repository checks.
