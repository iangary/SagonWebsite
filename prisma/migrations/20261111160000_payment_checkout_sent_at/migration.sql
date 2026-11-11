-- 綠界的 MerchantTradeNo 送過一次就不能再送（10300028 訂單編號重複）。
-- 記下第一次送出的時間，客人沒付款回來再按「前往付款」時改用一組新的單號。

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "checkoutSentAt" TIMESTAMP(3);

-- 既有的綠界付款一律當作已經送過：下單後會直接導去收銀台，幾乎都送過了。
-- 少數沒送過的被當成送過，只是多換一組單號，沒有壞處；反過來漏標就會再撞一次 10300028。
UPDATE "payments" SET "checkoutSentAt" = "createdAt" WHERE "provider" = 'ECPAY';
