-- 綠界電子發票改為電子收據。
--
-- 我們沒有申請綠界電子發票，紙本發票改為人工開立、隨包裹寄出，
-- 所以 invoices 只留抬頭與開立紀錄；載具、捐贈、綠界回應等欄位全部移除。
-- 綠界電子收據另開一張 receipts 表（不是統一發票，只是付款憑證）。

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'ISSUED', 'VOIDED', 'FAILED');

-- 人工開立沒有「開立失敗」這種狀態。舊資料裡的 FAILED 先收斂成 PENDING，
-- 否則下面的 enum 轉型會因為找不到對應值而整段失敗。
UPDATE "invoices" SET "status" = 'PENDING' WHERE "status" = 'FAILED';

-- AlterEnum
BEGIN;
CREATE TYPE "InvoiceStatus_new" AS ENUM ('PENDING', 'ISSUED', 'VOIDED');
ALTER TABLE "invoices" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "invoices" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING ("status"::text::"InvoiceStatus_new");
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
DROP TYPE "InvoiceStatus_old";
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "carrierNum",
DROP COLUMN "carrierType",
DROP COLUMN "donation",
DROP COLUMN "failReason",
DROP COLUMN "loveCode",
DROP COLUMN "randomNumber",
DROP COLUMN "rawResponse",
ADD COLUMN     "note" TEXT;

-- DropEnum
DROP TYPE "InvoiceCarrierType";

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "receiptNo" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "failReason" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- 既有訂單補一筆收據紀錄，避免開收據時找不到資料
INSERT INTO "receipts" ("id", "orderId", "amount", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "grandTotal", 'PENDING', NOW(), NOW()
FROM "orders";

-- CreateIndex
CREATE UNIQUE INDEX "receipts_orderId_key" ON "receipts"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_receiptNo_key" ON "receipts"("receiptNo");

-- CreateIndex
CREATE INDEX "receipts_status_idx" ON "receipts"("status");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
