# Build from the n2 repository root:
# docker build -f services/pii-provider/Dockerfile .
FROM oven/bun:1.2

WORKDIR /workspace

COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY packages/n2/package.json ./packages/n2/package.json
COPY packages/n2-service-shared/package.json ./packages/n2-service-shared/package.json
COPY examples/order/package.json ./examples/order/package.json
COPY services/profile-provider/package.json ./services/profile-provider/package.json
COPY services/request-provider/package.json ./services/request-provider/package.json
COPY services/pii-provider/package.json ./services/pii-provider/package.json

RUN bun install --frozen-lockfile

COPY packages ./packages
COPY examples ./examples
COPY services ./services

ENV NODE_ENV=production
ENV PORT=4120

EXPOSE 4120

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:4120/health'); if (!r.ok) process.exit(1)"

CMD ["bun", "services/pii-provider/src/server.ts"]
