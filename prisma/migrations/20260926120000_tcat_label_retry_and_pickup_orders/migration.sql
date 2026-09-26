-- 黑貓後台三件事：
--
-- 1. labelFileNo / labelFileNoIssuedAt
--    PrintOBT 回的託運單下載編號只有 24 小時有效。建單當下 PDF 沒抓到時，
--    後台要在期限內能補抓，所以把編號和取得時間存成欄位（原本只埋在 rawResponse 裡）。
--
-- 2. statusPollError
--    貨態查詢被黑貓拒絕（例如 E009 憑證錯誤）時留下原因。以前這種情況被當成
--    「還沒有貨態」吞掉，訂單會安靜地停在運送中。
--
-- 3. pickupCallId
--    「呼叫黑貓」的 API 只收件數，指定哪幾張單是我們自己記：成功叫車時把選中的
--    shipment 掛到那一筆 tcat_pickup_calls。叫車紀錄被刪掉時只解除關聯，不動物流單。

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "labelFileNo" TEXT,
ADD COLUMN     "labelFileNoIssuedAt" TIMESTAMP(3),
ADD COLUMN     "pickupCallId" TEXT,
ADD COLUMN     "statusPollError" TEXT;

-- CreateIndex
CREATE INDEX "shipments_pickupCallId_idx" ON "shipments"("pickupCallId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_pickupCallId_fkey" FOREIGN KEY ("pickupCallId") REFERENCES "tcat_pickup_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
