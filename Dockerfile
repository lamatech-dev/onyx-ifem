# syntax=docker/dockerfile:1.8

ARG NODE_IMAGE=node:24.18.0-bookworm-slim

FROM ${NODE_IMAGE} AS verify
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY contracts ./contracts
COPY src ./src
COPY tests ./tests
COPY tools ./tools
COPY tsconfig.json ./

RUN npm run check

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    ONYX_HOST=0.0.0.0 \
    ONYX_PORT=3000 \
    ONYX_DB_PATH=/var/lib/onyx/onyx.db \
    ONYX_AUTH_MODE=required \
    ONYX_AUTH_PUBLIC_KEY_PATH=/run/secrets/onyx-auth-public.pem

WORKDIR /app
RUN install -d -o node -g node /var/lib/onyx

COPY --from=verify --chown=node:node /workspace/package.json ./package.json
COPY --from=verify --chown=node:node /workspace/contracts ./contracts
COPY --from=verify --chown=node:node /workspace/src ./src

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((response) => { if (!response.ok) throw new Error(String(response.status)); }).catch(() => process.exit(1));"]

CMD ["node", "--experimental-strip-types", "src/mission/server.ts"]
