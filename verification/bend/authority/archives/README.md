# Preserved input

The ZIP in this directory is the original downloaded kit, unchanged. Its original documentation and evidence describe the earlier package, not this upgrade. Do not deploy it or apply its old patch over the already-fixed integration.

The parent preserves compiler and historical excerpt bytes as hash-verified gzip
archives. This child reuses those files through the parent loader.

`authority-upgrade-manifest.json` records the supplied upgrade before local
adaptation. It was verified during installation; its checksums are provenance,
not checksums for the now-formatted local source. Current identities belong to
the reports in `../evidence/current/`.
