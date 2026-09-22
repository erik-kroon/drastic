# OpenERP documentation

OpenERP turns retained evidence into reviewed accounting decisions, approved postings, reconciled books and reproducible reports. These documents define the product, its accounting boundaries and the work needed to deliver it.

The repository contains a synthetic accounting implementation and ongoing domain work. Implementation, observed behavior, company readiness and external acceptance are separate claims. The [roadmap](roadmap.md) records progress and evidence; the [delivery plan](plans/README.md) specifies the remaining work.

## Reading order

The [open-accounting decision](adr/0005-open-accounting-and-managed-services.md), [architecture follow-up](architecture-followup.md), [licensing policy](../LICENSING.md) and [self-host setup](../infra/self-host/README.md) describe the open-source distribution and the latest design reconciliation.

| Document                                               | Question it answers                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [Product scope](product.md)                            | Who is the product for, and what must it do?                                                             |
| [Architecture](architecture.md)                        | Which module owns each responsibility, and where does it run?                                            |
| [Domain and invariants](domain.md)                     | What do the records mean, and what must never become false?                                              |
| [Operations and review](operations.md)                 | How do people and agents prepare, approve, execute and recover work?                                     |
| [Compliance and interoperability](compliance.md)       | Which capabilities need dated rules, formats and external acceptance?                                    |
| [Roadmap](roadmap.md)                                  | What has been observed, and what proves each phase complete?                                             |
| [Accounting delivery plan](plans/README.md)            | What remains across posting, corrections, imports, commerce, accounting depth, year-end and operations?  |
| [FND-01 reconciliation](plans/fnd01-reconciliation.md) | Which contracts and callers exist, what must remain compatible, and what does the pinned evidence prove? |
| [Verification scenarios](verification.md)              | Which failures must the real application withstand?                                                      |
| [Verification strategy](verification-strategy.md)      | How should the runtime, browser and database produce repeatable evidence?                                |
| [Design coverage](design-coverage.md)                  | Where are the detailed requirements, edge cases and proof gates owned?                                   |
| [Open decisions](open-decisions.md)                    | Which company facts, contracts and evidence are still needed?                                            |
| [Architecture decisions](adr/README.md)                | What choices have been made, and why?                                                                    |
| [Official sources](sources/README.md)                  | Which primary sources need review before rules and integrations can be activated?                        |

## Authority and status

The user's current request and [repository instructions](../AGENTS.md) govern the work. A design document specifies intended behavior; it does not grant operational authority or prove that behavior has been implemented.

- **Established:** observed in repository code or explicitly required by the user or repository instructions.
- **Working decision:** the selected design, with its rationale and consequences. It remains revisable.
- **Open:** a missing decision, fact or proof with a named gate in [open decisions](open-decisions.md).
- **Verified:** a specific observation tied to an artifact, environment and revision. A build does not verify financial behavior.

## Maintaining the docs

High-level documents own requirements and invariants. The area plans own detailed delivery contracts and work packets. The roadmap owns progress and links to evidence. The coverage map connects these owners without creating a second specification.

Change a material working decision through its ADR and update the affected requirements, operations and proof gates together. Record an unresolved question once and link its identifier. Do not create empty modules just to match an architecture diagram.

Executable wire schemas belong in `packages/contracts`; generated OpenAPI and MCP descriptions follow those schemas. Preserve supported routes and sealed-record interpretation. Retain dated research and runtime evidence with their limitations, and distinguish planned behavior from implementation and observed results.
