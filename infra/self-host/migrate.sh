#!/bin/sh
set -eu
bun apps/api/scripts/migrate.ts
bun apps/api/scripts/self-host-role.ts
