# 构建前端产物（vite build 需要完整 devDependencies）
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS console

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend
COPY frontend/ ./frontend/
RUN npm run build --prefix frontend

# 运行时：仅后端源码 + mysql2 + 已构建的前端 dist
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend

COPY backend/server.js backend/schema.sql ./backend/
COPY backend/migrations/ ./backend/migrations/
COPY --from=console /build/frontend/dist/ ./frontend/dist/

EXPOSE 3001
# /api/health 会执行 SELECT 1，数据库不通时即视为不健康
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(4000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

WORKDIR /app/backend
CMD ["node", "server.js"]
