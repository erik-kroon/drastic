# Effect lint provenance

Copied from `src/effect` in https://github.com/dmmulroy/anti-slop at
`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`, matching the parent
`UPSTREAM_REVISION`. The parent `LICENSE` retains the MIT notice.
Upstream test files were excluded. Local changes apply formatting and structural
blank lines without changing rule behavior.

The plugin is registered in the base config. Its rules are enabled as errors by
`.oxlintrc.changed.json`, used by the changed-file commands and the PR lint gate.
Existing workspace lint does not require historical files to adopt these rules
before they are touched.

The real-command proof is `verification/lint-changed/run.mjs`.
