-- 首頁 Hero 的英文文案。
--
-- Category 已經有 nameEn，Banner 卻沒有對應欄位，所以英文站的首頁標語
-- 只能吐出資料庫裡的中文。補上這兩欄後，英文站有英文就用英文，
-- 沒填就退回 messages/en.json 的預設標語（見 src/app/[locale]/page.tsx）。

-- AlterTable
ALTER TABLE "banners" ADD COLUMN "titleEn" TEXT,
ADD COLUMN "subtitleEn" TEXT;
