# Build context: the combined repository root (see /.dockerignore).
#   docker build -f apps/api/Dockerfile .

ARG APP_VERSION=local
ARG SOURCE_REVISION=unknown

FROM node:24.16.0-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# openssl lets Prisma select the engine that matches the runtime image.
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate && \
    apt-get update && apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Only the API is installed from the root lockfile. Every workspace manifest is
# present so the frozen lockfile matches. The hoisted layout keeps the flat
# node_modules the API has always run with.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY packages/ui-common/package.json packages/ui-common/
COPY openapi/package.json openapi/

FROM base AS build

RUN pnpm install --frozen-lockfile --filter hey-hey-api --config.node-linker=hoisted

COPY . .

# Generated code is committed; refuse to compile when it does not match the
# in-checkout specifications. No .git in the context, so pin the source root.
ENV HEY_HEY_OPENAPI_ROOT=/workspace/openapi
RUN pnpm generate:verify

# prebuild generates the Prisma client before nest build.
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter hey-hey-api build

FROM base AS production-dependencies

RUN pnpm install --frozen-lockfile --prod --filter hey-hey-api --config.node-linker=hoisted
# The Prisma client generated during the build replaces the ungenerated stub.
COPY --from=build /workspace/node_modules/.prisma ./node_modules/.prisma

FROM node:24.16.0-bookworm-slim AS runtime

ARG APP_VERSION
ARG SOURCE_REVISION

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

LABEL org.opencontainers.image.title="hey-hey-api"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"

RUN apt-get update && apt-get install -y --no-install-recommends openssl wget default-jre-headless && \
    wget --tries=5 --timeout=30 --retry-connrefused --waitretry=10 \
        -O /tmp/flyway.tar.gz \
        https://download.red-gate.com/maven/release/com/redgate/flyway/flyway-commandline/11.3.4/flyway-commandline-11.3.4-linux-x64.tar.gz && \
    tar -xzf /tmp/flyway.tar.gz && \
    rm /tmp/flyway.tar.gz && \
    mv flyway-11.3.4 /opt/flyway && \
    rm -rf /opt/flyway/jre && \
    ln -s /opt/flyway/flyway /usr/local/bin/flyway && \
    rm -rf /var/lib/apt/lists/*

# Hoisted workspace dependencies sit above /app so Node resolves the API's own
# nested versions (/app/node_modules) first, exactly as in the workspace.
COPY --from=production-dependencies /workspace/node_modules /node_modules
COPY --from=production-dependencies /workspace/apps/api/node_modules ./node_modules
COPY --from=build /workspace/apps/api/dist ./dist
COPY apps/api/prisma ./prisma
COPY apps/api/config ./config
COPY apps/api/package.json ./package.json
COPY apps/api/scripts ./scripts
COPY apps/api/db ./db
COPY apps/api/content ./content
COPY apps/api/docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
