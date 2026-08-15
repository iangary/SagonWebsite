# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# base — 共用的 Node 環境。argon2 需要編譯工具鏈才能安裝原生模組。
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# deps — 安裝相依套件（含 build toolchain，之後不進 runner）
# ---------------------------------------------------------------------------
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# ---------------------------------------------------------------------------
# dev — docker compose 開發用，原始碼由 bind mount 進來
# ---------------------------------------------------------------------------
FROM deps AS dev
ENV NODE_ENV=development
COPY prisma ./prisma
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
# builder — 產出 standalone bundle
# ---------------------------------------------------------------------------
FROM deps AS builder
ENV NODE_ENV=production
# 建置階段沒有真正的資料庫與金鑰，但 src/lib/env.ts 會在模組載入時驗證環境變數，
# 預渲染任何 import 到它的頁面就會失敗。這裡放一組僅供通過驗證的假值，
# 執行期會被 compose 的 env_file 完全覆蓋。
ENV APP_URL=http://localhost:3000 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379 \
    AUTH_SECRET=build-time-placeholder-secret \
    ECPAY_MERCHANT_ID=0 ECPAY_HASH_KEY=0 ECPAY_HASH_IV=0 \
    ECPAY_LOGISTICS_MERCHANT_ID=0 ECPAY_LOGISTICS_HASH_KEY=0 ECPAY_LOGISTICS_HASH_IV=0 \
    ECPAY_SENDER_NAME=build ECPAY_SENDER_CELLPHONE=0900000000 \
    ECPAY_SENDER_ZIPCODE=000 ECPAY_SENDER_ADDRESS=build \
    ECPAY_RECEIPT_MERCHANT_ID=0 ECPAY_RECEIPT_HASH_KEY=0 ECPAY_RECEIPT_HASH_IV=0 \
    TCAT_CUSTOMER_ID=0 TCAT_CUSTOMER_TOKEN=0 TCAT_SENDER_ZIP=000000
COPY . .
# public/ 目前只有 uploads（被 .dockerignore 排除）且沒有任何檔案進 git，
# 所以 CI 上的 build context 根本沒有這個目錄，runner 的 COPY 會失敗。
# 先建出來，日後放靜態資源進去也不影響。
RUN mkdir -p /app/public
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
# migrate — 一次性容器，只負責套用 migration 後結束
#
# 刻意跟 runner 分開：Prisma CLI 有一整串傳遞相依，硬要從 standalone 的精簡
# node_modules 裡挑幾個目錄複製過去一定會缺東西。這裡直接用有完整 node_modules
# 的 deps 階段，runner 就能保持乾淨。
# ---------------------------------------------------------------------------
FROM deps AS migrate
ENV NODE_ENV=production
COPY prisma ./prisma
RUN npx prisma generate
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# runner — 最終 production image，non-root
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# storage/labels 要先建出來並歸 node 所有：Docker 建立具名 volume 時會沿用
# 映像檔裡該路徑的擁有者，路徑不存在就會變成 root 的，非 root 的 node 寫不進去。
RUN mkdir -p /app/public/uploads /app/storage/labels && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
# worker — 背景佇列消費者，共用 builder 的產物但跑 tsx
# ---------------------------------------------------------------------------
FROM base AS worker
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# worker 會把黑貓託運單 PDF 寫進這裡（見 lib/tcat/labels.ts），
# 同 runner：路徑要先存在且屬於 node，volume 掛上來才不會是 root 的。
RUN mkdir -p /app/storage/labels && chown -R node:node /app
USER node
# server-only 在 Next 的 bundler 外會直接拋錯，用 react-server condition 讓它解析成空模組。
# 容器內的環境變數由 compose 的 env_file 提供，--env-file-if-exists 只是本機跑的方便。
CMD ["npx", "tsx", "--env-file-if-exists=.env", "--conditions=react-server", "src/worker/index.ts"]
