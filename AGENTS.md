# OpenERP agent rules

## Work
- Use Linear MCP to track work in the existing OpenERP project.
- Make one issue for each result that can be finished and checked.
- Add source links, done checks, and an owner or blocker to each issue.
- Do not ticket finished or deferred work. Do not make one issue per register row.
- Before code changes, read `docs/README.md` and `docs/open-decisions.md`. For `NEXT-nn`, also read its dossier and spec.
- Keep plans, code, and check results distinct. Update docs when facts or decisions change.

## Frontend design and code
- Use Paper MCP to design frontend screens. Work on one screen at a time in `Enthusiastic lantern`.
- Follow `docs/ui-design-prompt.md`, `docs/ui-design-checklist.md`, and `verification/paper/baseline/`.
- Read frame code and styles with Paper `get_jsx` and `get_computed_styles`. Use shared components and UI tokens. Draft designs are not approval or proof of implementation.
- Keep route files thin. Compose pages from owned components; do not put the full interface in a page or route.
- Build with StyleX and existing UI components. A screen is done when its parity check passes and its diff is saved. See `verification/paper/`.

## Safety and checks
- Follow accounting and code ownership in `docs/README.md` and `apps/api/README.md`. Read financial amounts from stored records, not client input.
- Keep anti-slop Oxlint rules enabled. Fix lint and TypeScript errors; do not suppress warnings or weaken checks.
- Run `bun run check:changed` after each coherent code edit. Run `bun run check:changed:full` before handoff and after Promise or async changes.
- Use synthetic test data. Do not use real company data, live providers, production systems, payments, deployments, or statutory submissions without task-specific authorization.
