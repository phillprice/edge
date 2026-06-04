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

# /data is the Fly.io persistent volume mount point for the SQLite database.
# Create it now so the node user owns it; Fly mounts the volume over it at runtime
# and preserves the ownership of the mount root.
RUN mkdir -p /data && chown -R node:node /app /data

EXPOSE 8080
ENV PORT=8080
# Run as non-root user — all files in /app and /data are owned by node (see chown above)
USER node
CMD ["node", "server.js"]
