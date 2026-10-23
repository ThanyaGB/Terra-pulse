FROM node:22-alpine AS build
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
COPY packages/contracts /packages/contracts
ARG VITE_API_MODE=live
ARG VITE_API_BASE_URL=/v1
ARG VITE_WS_URL=
ENV VITE_API_MODE=$VITE_API_MODE VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_WS_URL=$VITE_WS_URL
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /web/dist /usr/share/nginx/html
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
