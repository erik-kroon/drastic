# Changed-file lint proof

Run `node verification/lint-changed/run.mjs`. The probe runs the real lint command
against a disposable Git repository with the installed Oxlint and vendored rules.
It writes command output, exit codes and source hashes to
`test-results/lint-changed/results.json`.

Failure cases specified before implementation:

- An untouched warning must not block a clean changed file.
- Touching a file containing an existing warning must fail, including after a
  branch commit when compared with its base revision.
- An untracked file containing a warning must fail.
- A clean file whose name contains spaces must be checked and pass.
- Each Effect rule must reject its prohibited pattern; supported matching and
  constructors must pass.
- Lint-only checking must not rewrite files.
- An invalid base revision must fail rather than report no changed files.

The full changed-file check additionally retains formatting and TypeScript checks.
CI runs the lint-only command against the pull request's base SHA.
