# Stage 1: build frontend
FROM --platform=linux/amd64 node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
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
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
