# ---- Build stage ----
FROM --platform=$BUILDPLATFORM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ENV VITE_TASK_BACKEND=flyreq
ENV VITE_DEFAULT_API_URL=__VITE_DEFAULT_API_URL_PLACEHOLDER__
ENV VITE_API_PROXY_AVAILABLE=__VITE_API_PROXY_AVAILABLE_PLACEHOLDER__
ENV VITE_API_PROXY_LOCKED=__VITE_API_PROXY_LOCKED_PLACEHOLDER__
ENV VITE_DOCKER_DEPLOYMENT=__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__
ENV VITE_DOCKER_LEGACY_API_URL_USED=__VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__
ENV VITE_PROMO_API_URL=__VITE_PROMO_API_URL_PLACEHOLDER__
ENV VITE_PROMO_API_LABEL=__VITE_PROMO_API_LABEL_PLACEHOLDER__

COPY . .
RUN npm run build

# ---- Persistent FlyReq task backend ----
FROM node:24-alpine AS backend

WORKDIR /app/backend
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++
COPY package.json /app/package.json
COPY backend/*.js backend/*.json backend/LICENSE ./
ENV AIPIC_HOST=0.0.0.0
ENV PORT=8788
ENV FLYREQ_TASK_DB=/data/tasks.sqlite
ENV FLYREQ_IMAGE_DIR=/data/images
ENV FLYREQ_VIDEO_DIR=/data/videos
ENV FLYREQ_LOG_DIR=/data/logs
VOLUME ["/data"]
EXPOSE 8788
CMD ["node", "server.js"]

# ---- Frontend and same-origin gateway ----
FROM nginx:alpine AS frontend

ENV HOST=0.0.0.0
ENV PORT=80
ENV DEFAULT_API_URL=https://sub2api.simplaj.top/
ENV API_PROXY_URL=https://sub2api.simplaj.top/v1
ENV ENABLE_API_PROXY=true
ENV LOCK_API_PROXY=true
ENV PROMO_API_URL=https://sub2api.simplaj.top/
ENV PROMO_API_LABEL="稳定API中转站，注册送5刀，可免费修10张图"

COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/migrate-api-env.envsh /docker-entrypoint.d/05-migrate-api-env.envsh
COPY --chmod=755 deploy/inject-api-url.sh /docker-entrypoint.d/40-inject-api-url.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
