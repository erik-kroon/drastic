FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY package.json bun.lock vite.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY jurisdictions ./jurisdictions
COPY config ./config
COPY examples ./examples
COPY infra/self-host ./infra/self-host
COPY LICENSE LICENSING.md ./
RUN bun install --frozen-lockfile
RUN bun run --cwd apps/web build

FROM oven/bun:1.4.0
WORKDIR /app
COPY --from=build --chown=bun:bun /app /app
USER bun
EXPOSE 3000
CMD ["bun", "apps/api/scripts/self-host.ts"]
