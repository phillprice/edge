# Stage 1: build frontend
FROM --platform=linux/amd64 node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# VITE_CLERK_PUBLISHABLE_KEY is the PUBLIC key (pk_*) — safe to bake into the bundle
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm run build

# Stage 2: backend
FROM --platform=linux/amd64 node:22-slim
WORKDIR /app/backend
# gosu lets the entrypoint drop from root to the node user after fixing volume ownership.
# Versions aren't pinned per-package: this is a slim native-build toolchain whose
# versions are tracked by the node:22-slim base image, not individually here.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ gosu && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
RUN npm rebuild better-sqlite3
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
# /data is the Fly.io persistent volume mount point for the SQLite database
RUN mkdir -p /data
EXPOSE 8080
ENV PORT=8080
# The entrypoint runs as root only to chown the runtime-mounted volume, then
# drops to the unprivileged node user via gosu before exec'ing the CMD — so the
# app process is NOT root. Static analysers can't see the gosu hand-off and flag
# the missing USER directive; suppressed here because the runtime is non-root.
# (A build-time `USER node` can't work: Fly.io mounts the volume as root at
# runtime, so the entrypoint must start as root to chown it. See docker-entrypoint.sh.)
# nosemgrep
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
