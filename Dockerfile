# Stage 1: build frontend
FROM --platform=linux/amd64 node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm run build

# Stage 2: backend
FROM --platform=linux/amd64 node:22-alpine
WORKDIR /app/backend
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
RUN npm rebuild better-sqlite3
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
