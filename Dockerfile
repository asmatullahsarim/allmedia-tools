FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --chown=node:node server.js ./
COPY --chown=node:node web/ ./web/

ENV NODE_ENV=production \
    PORT=10000 \
    WORK_TMP_DIR=/tmp/allmedia_work

USER node
EXPOSE 10000
CMD ["node", "server.js"]
