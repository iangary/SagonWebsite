-- 對齊舊站 FAQ（sagan.com.tw/faq）的兩條規則：
--
-- 1. 預購
--    products.preorderEnabled：後台開啟後，可售數量不足時仍可下單。
--    order_items.isPreorder：那一行以預購成立，沒有佔庫存，等到貨才出貨。
--
-- 2. 停止購買服務
--    拒收、逾期未取件達一次即停止後續購買。由後台人工切換（不自動），
--    users.purchaseBlockedAt 非 null 的會員不能結帳。

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "preorderEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "isPreorder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "purchaseBlockReason" TEXT,
ADD COLUMN     "purchaseBlockedAt" TIMESTAMP(3);
