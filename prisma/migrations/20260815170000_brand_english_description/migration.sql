-- 關於頁的品牌簡介英文版。
--
-- 品牌卡片的名稱本來就是英文（MMOM、LUNALUZ…），但底下那句簡介只有中文，
-- 英文站的「合作品牌」區塊因此中英混排。補上這一欄後由 pickLocalized 挑選。

-- AlterTable
ALTER TABLE "brands" ADD COLUMN "descriptionEn" TEXT;
