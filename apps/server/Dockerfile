FROM node:22-trixie-slim@sha256:68c76cfad89921b927eae28ba21407475e29d0ce450afcdbe70c1532db042b64 AS web
WORKDIR /repo
COPY packages/core/package.json packages/core/package-lock.json packages/core/
RUN cd packages/core && npm ci
COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN cd apps/web && npm ci
COPY packages/core/ packages/core/
COPY apps/web/ apps/web/
ENV VITE_API_URL=/api
RUN cd packages/core && npm run build:engine \
    && cd ../../apps/web && npm run build

FROM rust:1.99.1-slim-trixie@sha256:f6c4a35d21dbb3c89d7a8d056c193e94fc09037f2b58dd858b09c39a47dd02d7 AS rust
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config cmake build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /src
ENV SQLX_OFFLINE=true CARGO_TERM_COLOR=never
COPY apps/server/ ./
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --bin tessery-server --bin tessery-worker \
    && cp target/release/tessery-server target/release/tessery-worker /usr/local/bin/

FROM docker:28-cli@sha256:625d9431a9f54c5a2bc90f24f0e1c3d55b1349fd857dd85035f98c2c9acbdd4d AS docker

FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home tessery \
    && mkdir -p /var/lib/tessery && chown tessery /var/lib/tessery
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
USER tessery
ENV RUST_LOG=info TESSERY_BIND=0.0.0.0:8080 TESSERY_DATA_DIR=/var/lib/tessery
VOLUME /var/lib/tessery

FROM runtime AS server
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /repo/packages/core/dist/tessery-engine.mjs /usr/local/lib/tessery/tessery-engine.mjs
COPY --from=web /repo/apps/web/dist /srv/web
COPY --from=rust /usr/local/bin/tessery-server /usr/local/bin/tessery-server
ENV TESSERY_WEB_DIR=/srv/web TESSERY_ENGINE_SCRIPT=/usr/local/lib/tessery/tessery-engine.mjs TESSERY_NODE_BIN=/usr/local/bin/node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/tessery-server"]

FROM runtime AS worker
COPY --from=rust /usr/local/bin/tessery-worker /usr/local/bin/tessery-worker
ENTRYPOINT ["/usr/local/bin/tessery-worker"]
