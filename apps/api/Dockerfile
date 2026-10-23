FROM node:24.16.0-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

RUN apt-get update && apt-get install -y wget default-jre-headless && \
    wget --tries=5 --timeout=30 --retry-connrefused --waitretry=10 \
        -O /tmp/flyway.tar.gz \
        https://download.red-gate.com/maven/release/com/redgate/flyway/flyway-commandline/11.3.4/flyway-commandline-11.3.4-linux-x64.tar.gz && \
    tar -xzf /tmp/flyway.tar.gz && \
    rm /tmp/flyway.tar.gz && \
    mv flyway-11.3.4 /opt/flyway && \
    rm -rf /opt/flyway/jre && \
    ln -s /opt/flyway/flyway /usr/local/bin/flyway && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for layer caching.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Copy source and build the production artifact.
COPY . .
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm build

FROM build AS production-dependencies
# Dependencies were built above; pruning must not rerun development hooks.
RUN pnpm prune --prod --config.ignore-scripts=true

FROM node:24.16.0-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

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

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/config ./config
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/db ./db
COPY --from=build /app/content ./content
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
