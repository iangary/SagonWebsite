-- 黑貓宅急便直接串接：託運單 PDF 與貨態輪詢所需的欄位。
--
-- labelPath / labelDownloadedAt：
--   黑貓的 FileNo 自建單起算只有 24 小時有效，逾期就只能重新建單（會產生新的
--   託運單號）。所以建單成功後要立刻把 PDF 抓回來落地，這兩欄記錄存放結果。
--   檔案不放 public/ —— 託運單上有收件人姓名、地址、電話。
--
-- statusPolledAt：
--   黑貓沒有貨態回拋，只能主動查，而且同一託運單號每 2 小時才准查一次。
--   用這一欄節流，避免超過限制被擋。

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "labelPath" TEXT,
ADD COLUMN "labelDownloadedAt" TIMESTAMP(3),
ADD COLUMN "statusPolledAt" TIMESTAMP(3);

-- CreateIndex
-- 輪詢每半小時掃一次「還在路上且超過 2 小時沒查」的黑貓單
CREATE INDEX "shipments_logisticsSubType_status_statusPolledAt_idx" ON "shipments"("logisticsSubType", "status", "statusPolledAt");
