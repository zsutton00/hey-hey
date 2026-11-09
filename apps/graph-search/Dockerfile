# Build from the repository root: docker build -f apps/graph-search/Dockerfile .
FROM rust:1.97.0-trixie AS build
WORKDIR /app
COPY apps/graph-search/ ./
RUN cargo build --locked --release

FROM debian:trixie-slim AS runtime
ARG APP_VERSION=local
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="hey-hey-graph-search"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/hey-hey-graph-search /usr/local/bin/hey-hey-graph-search
USER 65532:65532
ENV GRAPH_SEARCH_BIND=0.0.0.0:8090
ENV SEARCH_EMBEDDING_MODEL_DIR=/models/snowflake-arctic-embed-s
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=6s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8090/healthz || exit 1
ENTRYPOINT ["hey-hey-graph-search"]
