ARG APP_VERSION=local

FROM node:22.23.4-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

WORKDIR /app

# Provide local ui-common workspace dependency (`file:../ui-common`) via
# BuildKit additional context. Install its source-build dependencies from its
# own lockfile, then copy source so Vite compiles it directly without tsup.
COPY --from=ui_common /package.json /pnpm-lock.yaml /pnpm-workspace.yaml /ui-common/
RUN cd /ui-common && pnpm install --frozen-lockfile --ignore-workspace --ignore-scripts
COPY --from=ui_common /src /ui-common/src

# Keep the container build independent of local worktree links.  The additional
# context is copied to /ui-common.
ENV HEY_HEY_UI_COMMON_ROOT=/ui-common

# Install dependencies first for stable and cacheable builds.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build UI assets.
COPY . .
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vite build

FROM node:22.23.4-bookworm-slim AS runtime

ARG APP_VERSION

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info

LABEL org.opencontainers.image.title="hey-hey-ui"
LABEL org.opencontainers.image.version="${APP_VERSION}"

COPY --from=build /app/dist ./dist
COPY docker/server.mjs ./docker/server.mjs

EXPOSE 5173

CMD ["node", "docker/server.mjs"]
