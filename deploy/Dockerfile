# Build the browser application on the builder's native architecture.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

ENV VITE_TASK_BACKEND=flyreq \
    VITE_DEFAULT_API_URL=__VITE_DEFAULT_API_URL_PLACEHOLDER__ \
    VITE_API_PROXY_AVAILABLE=__VITE_API_PROXY_AVAILABLE_PLACEHOLDER__ \
    VITE_API_PROXY_LOCKED=__VITE_API_PROXY_LOCKED_PLACEHOLDER__ \
    VITE_DOCKER_DEPLOYMENT=__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__ \
    VITE_DOCKER_LEGACY_API_URL_USED=__VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__

# .dockerignore allows source files only: no local secrets, database or outputs.
COPY . .
RUN tar --exclude='./node_modules' --exclude='./dist' --exclude='./aipic-source.tar.gz' \
        -czf /tmp/aipic-source.tar.gz . \
    && npm run build \
    && cp /tmp/aipic-source.tar.gz dist/aipic-source.tar.gz

# Native dependencies must be installed for the target image's architecture.
FROM node:24-alpine AS backend-dependencies
WORKDIR /app/backend
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# One image serves the UI, API proxy, persistent queue and WebSocket updates.
FROM node:24-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libstdc++ \
    && mkdir -p /data /app/dist \
    && chown node:node /data /app/dist
COPY --from=backend-dependencies /app/backend/node_modules ./backend/node_modules
COPY backend/*.js backend/*.json backend/LICENSE backend/README.md ./backend/
COPY package.json LICENSE README.md ./
COPY --from=build /app/dist ./dist-template
COPY deploy/inject-runtime-config.mjs ./deploy/inject-runtime-config.mjs
COPY --chmod=755 deploy/docker-entrypoint.sh /usr/local/bin/aipic-entrypoint

ENV NODE_ENV=production \
    AIPIC_HOST=0.0.0.0 \
    PORT=8788 \
    AIPIC_STATIC_DIR=/app/dist \
    ENABLE_API_PROXY=true \
    LOCK_API_PROXY=true \
    FLYREQ_TASK_DB=/data/tasks.sqlite \
    FLYREQ_IMAGE_DIR=/data/images \
    FLYREQ_VIDEO_DIR=/data/videos \
    FLYREQ_LOG_DIR=/data/logs/application \
    FLYREQ_IMAGE_UPSTREAM_LOG_DIR=/data/logs/image-upstream \
    FLYREQ_VIDEO_UPSTREAM_LOG_DIR=/data/logs/video-upstream \
    FLYREQ_TASK_CONCURRENCY=4

USER node
VOLUME ["/data"]
EXPOSE 8788
ENTRYPOINT ["aipic-entrypoint"]
CMD ["node", "backend/server.js"]
