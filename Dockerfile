# ============================================
# Stage 1: Build the SPA
# ============================================
# Node 24 for its npm 11: package-lock.json does not install with the npm 10
# that ships in node:22 (`npm ci` reports it out of sync).
FROM node:24-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Nothing is configured here: the bundle reads its configuration at runtime
# (see the runtime stage), so one image serves every deployment.
RUN npm run build

# ============================================
# Stage 2: Serve it
# ============================================
# Unprivileged nginx: runs as uid 101 and listens on 8080.
FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime

# Where /api is proxied to. Substituted into the config at container start.
ENV PINCER_API_UPSTREAM=http://pincer:8080

# App configuration, read at container start: every VITE_* and SIGNUP_* variable
# is written to /config.js, which the page loads before the bundle. They are
# served to the browser, so none may be a secret; a restart applies a change.
#   VITE_PINCER_API_URL    unset = same origin; nginx here proxies /api to Pincer
#   VITE_NOTES_API_URL     base URL of the Notes service; unset = /notes says so
#   VITE_NOTES_TOKEN       a token for the Notes service, if it has its own
#   VITE_NOTES_AGENT_CHAT  "1" shows the Agent tab in the Notes ask panel
#   SIGNUP_ALLOWED         "true" adds the /signup request-access page
COPY --chmod=755 docker/40-runtime-env.sh /docker-entrypoint.d/

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=5s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
