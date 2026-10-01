# Next.js dashboard image (also used by the `migrate` job in docker-compose.yml).
# Build context: repository root.
FROM node:20-bookworm-slim AS base
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
# DejaVu Sans: claim PDFs render accents, Greek, Cyrillic, Vietnamese, Arabic...
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder /app/package.json /app/package-lock.json /app/next.config.js ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
# Stamps the TCP peer address on each request (x-rapidos-socket-ip) for rate limiting.
COPY --from=builder /app/scripts/socket-ip.cjs ./scripts/socket-ip.cjs
# /app/storage is the dashboard_files volume (claim documents and PDFs).
RUN mkdir -p /app/storage && chown -R node:node /app/.next /app/storage
USER node
EXPOSE 3000
CMD ["node", "--require", "./scripts/socket-ip.cjs", "node_modules/next/dist/bin/next", "start"]
