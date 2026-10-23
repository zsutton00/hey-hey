# syntax=docker/dockerfile:1

ARG APP_VERSION=local

FROM node:24.16.0-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

WORKDIR /ui-common
COPY --from=ui_common /package.json /pnpm-lock.yaml /pnpm-workspace.yaml ./
RUN --mount=type=cache,id=heyhey-migration-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --store-dir /pnpm/store --frozen-lockfile --ignore-workspace --ignore-scripts
COPY --from=ui_common /src ./src
COPY --from=ui_common /public ./public

WORKDIR /app
COPY --from=ui /package.json /pnpm-lock.yaml /pnpm-workspace.yaml ./

# Migration worktrees may intentionally contain package.json changes before the
# lockfile is finalized. Resolve them inside the image without changing source.
RUN --mount=type=cache,id=heyhey-migration-pnpm,target=/pnpm/store,sharing=locked \
    pnpm install --store-dir /pnpm/store --no-frozen-lockfile

COPY --from=ui / ./
ENV HEY_HEY_UI_COMMON_ROOT=/ui-common
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vite build

FROM node:24.16.0-bookworm-slim AS runtime

ARG APP_VERSION

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info

LABEL org.opencontainers.image.title="hey-hey-ui"
LABEL org.opencontainers.image.version="${APP_VERSION}"

COPY --from=build /app/dist ./dist
COPY --from=ui /docker/server.mjs ./docker/server.mjs

EXPOSE 5173

CMD ["node", "docker/server.mjs"]
