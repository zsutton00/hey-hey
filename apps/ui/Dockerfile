# Build context: the combined repository root (see /.dockerignore).
#   docker build -f apps/ui/Dockerfile .

ARG APP_VERSION=local
ARG SOURCE_REVISION=unknown

FROM node:24.16.0-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

WORKDIR /workspace

# Install the UI and its workspace dependencies (UI Common) from the root
# lockfile. Every workspace manifest is present so the frozen lockfile matches.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY packages/ui-common/package.json packages/ui-common/
COPY openapi/package.json openapi/
RUN pnpm install --frozen-lockfile --filter hey-hey... --filter hey-hey-openapi

COPY . .

# Generated code is committed; refuse to compile when it does not match the
# in-checkout specifications. No .git in the context, so pin the source root.
ENV HEY_HEY_OPENAPI_ROOT=/workspace/openapi
RUN pnpm generate:verify

# Vite compiles UI Common from packages/ui-common/src.
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter hey-hey build

FROM node:24.16.0-bookworm-slim AS runtime

ARG APP_VERSION
ARG SOURCE_REVISION

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info

LABEL org.opencontainers.image.title="hey-hey-ui"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"

COPY --from=build /workspace/apps/ui/dist ./dist
COPY apps/ui/docker/server.mjs ./docker/server.mjs

EXPOSE 5173

CMD ["node", "docker/server.mjs"]
