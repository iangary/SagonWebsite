-- 預購從「整件商品」改成「每個規格各自開關」：同一件商品常是白色現貨、米色預購。
-- 原本在商品上開了預購的，底下每個規格都沿用開啟，行為不變。

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN "preorderEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "product_variants" v
SET "preorderEnabled" = true
FROM "products" p
WHERE v."productId" = p.id AND p."preorderEnabled" = true;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "preorderEnabled";
