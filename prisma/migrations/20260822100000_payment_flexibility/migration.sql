-- 付款流程彈性化：
--   1. 一張訂單可以有多筆付款紀錄（消費者可在待付款期間改用其他付款方式）
--   2. 貨到付款（由物流代收）
--   3. 消費者可申請退款
--   4. 後台可調的營運參數（付款期限、是否開放貨到付款）

-- ---------------------------------------------------------------------------
-- 1. payments：解除 orderId 的唯一限制，加上作廢與對帳欄位
-- ---------------------------------------------------------------------------
DROP INDEX "payments_orderId_key";

ALTER TABLE "payments" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "syncedAt" TIMESTAMP(3);

CREATE INDEX "payments_orderId_createdAt_idx" ON "payments"("orderId", "createdAt");
CREATE INDEX "payments_status_supersededAt_syncedAt_idx" ON "payments"("status", "supersededAt", "syncedAt");

-- 貨到付款：等物流代收，錢還沒進來
ALTER TYPE "PaymentStatus" ADD VALUE 'AWAITING_COLLECTION';

-- 貨到付款手續費（與運費分開記）
ALTER TABLE "orders" ADD COLUMN "codFee" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. 退款申請
-- ---------------------------------------------------------------------------
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED', 'FAILED');
CREATE TYPE "RefundMethod" AS ENUM ('CREDIT_REVERSE', 'MANUAL_TRANSFER');

CREATE TABLE "refund_requests" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "userId" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" "RefundMethod",
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "bankCode" TEXT,
    "bankAccountNo" TEXT,
    "accountName" TEXT,
    "adminNote" TEXT,
    "failReason" TEXT,
    "rawResponse" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refund_requests_status_createdAt_idx" ON "refund_requests"("status", "createdAt");
CREATE INDEX "refund_requests_orderId_idx" ON "refund_requests"("orderId");

ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. 商店設定（key/value）
-- ---------------------------------------------------------------------------
CREATE TABLE "shop_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
