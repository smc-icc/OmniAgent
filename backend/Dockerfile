# ── Build stage ──
ARG NODE_IMAGE=node:22.22.1-alpine
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# Pin the package manager used to resolve the audited lockfile.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile \
    && node -e "const fs=require('fs'),c=require('crypto'),h=p=>c.createHash('sha256').update(fs.readFileSync(p)).digest('hex');fs.writeFileSync('smc-release-dependencies.json',JSON.stringify({'package.json':h('package.json'),lockfile:h('pnpm-lock.yaml')}));"

COPY tsconfig.json ./
COPY prisma ./prisma
RUN pnpm prisma generate

COPY src ./src
COPY scripts ./scripts
COPY sql ./sql
# 说明：demo 演示页**不打进镜像**，改由 compose 以只读卷挂载到容器 /demo
# （与前端 dist 的处理方式一致；好处是改 demo 无需重建镜像）。见 03-compose-agent.yml。
RUN pnpm build

# Optional isolated Linux regression target; never copied into the runtime.
FROM builder AS release-tests
COPY vitest.release.config.ts ./
CMD ["pnpm", "test:release"]

# Keep Prisma CLI for offline migrate deploy, but not Vitest/Vite/ESLint.
FROM builder AS production-deps
RUN pnpm prune --prod

# ── Production stage ──
FROM ${NODE_IMAGE} AS runner
ARG RELEASE_VERSION=development
LABEL org.opencontainers.image.title="OmniAgent backend" org.opencontainers.image.version=$RELEASE_VERSION

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY --from=builder /app/dist ./dist
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/smc-release-dependencies.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/sql ./sql
COPY --from=builder /app/src/modules/access/access-catalog.json ./src/modules/access/access-catalog.json

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001
EXPOSE 9106
EXPOSE 19399

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/server.js"]
