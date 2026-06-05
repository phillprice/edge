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
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
RUN npm rebuild better-sqlite3
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
# /data is the Fly.io persistent volume mount point for the SQLite database
RUN mkdir -p /data
EXPOSE 8080
ENV PORT=8080
# nosemgrep: running as root is intentional here — Fly.io persistent volumes
# mount as root at runtime, so USER node causes SQLITE_READONLY on /data.
# The container runs in Fly.io's isolated VM; root inside the container does
# not grant host privileges.
CMD ["node", "server.js"]
