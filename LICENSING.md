# Licensing

OpenERP's project-owned source and documentation are licensed under the **GNU Affero General Public License, version 3 only** (`AGPL-3.0-only`). The complete license is in [LICENSE](LICENSE).

This choice applies throughout the application, accounting calculations, SQL migrations, jurisdiction implementations, REST/MCP layer, agent workflows, public synthetic evaluation material and project-owned contracts/SDKs. There is no separate permissive exception for contracts or a future Rust library. A future exception requires an explicit maintainer decision and the necessary rights; it is not implied by a package's role.

Copyright remains with the respective authors and contributors. Package manifests use the same SPDX identifier. `private: true` in a workspace manifest prevents accidental package publication; it does not make that source proprietary.

## Third-party material

Dependencies and any separately identified third-party files retain their own licenses, copyright notices and conditions. This project license does not relicense upstream source, remove notices, or grant rights to third-party datasets, charts, taxonomies, trademarks or credentials. Check provenance and compatible terms before copying code or fixtures. Architectural reference use alone does not establish that code has been incorporated.

For distributed releases, retain required third-party notices and record the dependency lockfile and exact source revision. Verify copied/adapted files individually. Do not describe the repository's historical reference corpus as newly licensed OpenERP code.

## Hosted operation and managed services

AGPL licensing applies to the program; charging for hosting, support or optional managed services does not change that grant. When operating a modified covered program for remote users, follow section 13's corresponding-source requirements. Include a prominent source offer that resolves to the complete corresponding source for the deployed version, including required build/install material. A link to an unrelated or newer branch is not a substitute for that release's source.

The planned managed-services boundary in [the architecture decision](docs/adr/0005-open-accounting-and-managed-services.md) is an engineering boundary, not a blanket exemption from license obligations. Separate repositories, processes or HTTP endpoints do not by themselves settle the license treatment of a combined work. Keep customer records and credentials out of source releases; do not claim that ordinary customer data has been licensed by this document.

Primary text: [GNU AGPL version 3](https://www.gnu.org/licenses/agpl-3.0.html). This file states the project's licensing choice and release practice; the license text controls.
